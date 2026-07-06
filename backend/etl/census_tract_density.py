"""Census lived-density ETL — population-weighted density per CA county/year.

Joins ACS 5-year tract populations to Census Gazetteer tract land areas and
computes weighted_density = sum(pop^2/area) / sum(pop) per county. Distinct
from the crude demographics.population_density.

Sources:
  - ACS5 B01003_001E (tract population), Census API (settings.census_api_key)
  - Census Gazetteer national tract file (ALAND_SQMI)

Usage:
    python -m etl.census_tract_density
    python -m etl.census_tract_density --start 2018 --end 2022
"""

import argparse
import csv
import io
import logging
import time
import zipfile
from collections import defaultdict

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal
from app.models import County, TractDensityCountyYear
from app.settings import settings
from etl._utils import track_etl_run
from etl.nhtsa_fars import build_county_lookup

logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2010
DEFAULT_END_YEAR = 2023
CA_STATE_FIPS = "06"

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "{gaz_year}_Gazetteer/{gaz_year}_Gaz_tracts_national.zip"
)
ACS_URL = (
    "https://api.census.gov/data/{year}/acs/acs5"
    "?get=B01003_001E&for=tract:*&in=state:06&in=county:*&key={key}"
)
MAX_RETRIES = 3
BACKOFF_BASE = 2


def gazetteer_year_for(acs_year: int) -> int:
    """Pair an ACS year with a same-tract-vintage Gazetteer year."""
    return 2019 if acs_year <= 2019 else 2023


def compute_weighted_density(tracts: list[dict]) -> tuple[float, int] | None:
    """Population-weighted density = sum(pop^2/area) / sum(pop).

    Excludes tracts with missing/non-positive pop or area. Returns
    (weighted_density, tract_count) or None when nothing contributes.
    """
    sum_pop = 0.0
    sum_term = 0.0
    count = 0
    for t in tracts:
        pop = t.get("pop")
        area = t.get("area_sqmi")
        if pop is None or area is None or pop <= 0 or area <= 0:
            continue
        sum_pop += pop
        sum_term += (pop * pop) / area
        count += 1
    if count == 0 or sum_pop <= 0:
        return None
    return (sum_term / sum_pop, count)


def aggregate_county_density(
    tract_rows: list[dict],
    gaz_land_by_geoid: dict[str, float],
    county_lookup: dict[int, int],
    year: int,
) -> list[dict]:
    """Join tract pop to gazetteer land by GEOID, group by county, compute."""
    by_county: dict[int, list[dict]] = defaultdict(list)
    for r in tract_rows:
        geoid = r.get("geoid", "")
        try:
            county_fips = int(geoid[2:5])
        except (ValueError, IndexError):
            continue
        code = county_lookup.get(county_fips)
        if code is None:
            continue
        area = gaz_land_by_geoid.get(geoid)
        if area is None:
            continue
        by_county[code].append({"pop": r.get("pop"), "area_sqmi": area})

    out: list[dict] = []
    for code, tracts in sorted(by_county.items()):
        res = compute_weighted_density(tracts)
        if res is None:
            continue
        wd, tc = res
        out.append({
            "county_code": code, "year": year,
            "weighted_density": wd, "tract_count": tc,
        })
    return out


def fetch_gazetteer_land(gaz_year: int) -> dict[str, float]:
    """Download a Gazetteer tract zip and return {GEOID: ALAND_SQMI} for CA."""
    url = GAZETTEER_URL.format(gaz_year=gaz_year)
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=120, follow_redirects=True)
            resp.raise_for_status()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_BASE ** (attempt + 1))
    else:
        logger.error("All retries failed for Gazetteer %d", gaz_year)
        raise last_error

    land: dict[str, float] = {}
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = next((n for n in zf.namelist() if n.lower().endswith(".txt")), None)
        if name is None:
            logger.warning("No .txt in Gazetteer %d zip", gaz_year)
            return land
        with zf.open(name) as fh:
            # Gazetteer files are tab-delimited; headers have trailing spaces.
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            reader = csv.DictReader(text, delimiter="\t")
            reader.fieldnames = [f.strip() for f in (reader.fieldnames or [])]
            for row in reader:
                geoid = (row.get("GEOID") or "").strip()
                if not geoid.startswith(CA_STATE_FIPS):
                    continue
                try:
                    land[geoid] = float((row.get("ALAND_SQMI") or "").strip())
                except ValueError:
                    continue
    return land


def fetch_tract_population(year: int, api_key: str) -> list[dict]:
    """Fetch ACS5 tract population for CA. Returns [{geoid, pop}]."""
    url = ACS_URL.format(year=year, key=api_key)
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=60, follow_redirects=True)
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(BACKOFF_BASE ** (attempt + 1))
    else:
        logger.error("All retries failed for ACS tract pop %d", year)
        raise last_error

    if not isinstance(data, list) or not data:
        logger.warning("ACS tract pop %d returned no rows (check CENSUS_API_KEY)", year)
        return []
    header = data[0]
    idx = {name: i for i, name in enumerate(header)}
    rows: list[dict] = []
    for row in data[1:]:
        geoid = f"{row[idx['state']]}{row[idx['county']]}{row[idx['tract']]}"
        raw = row[idx["B01003_001E"]]
        try:
            pop = int(raw) if raw not in (None, "") else None
        except ValueError:
            pop = None
        rows.append({"geoid": geoid, "pop": pop})
    return rows


@track_etl_run("tract_density")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Fetch + join + upsert lived-density rows for CA counties."""
    api_key = settings.census_api_key
    if not api_key:
        # Raise instead of returning: a missing key would otherwise record a
        # green run that loaded nothing (the silent-success class of M-B9).
        raise RuntimeError("CENSUS_API_KEY is not set. Add it to backend/.env")

    db = SessionLocal()
    gaz_cache: dict[int, dict[str, float]] = {}
    try:
        counties = db.query(County.code, County.fips).all()
        lookup = build_county_lookup([(c.code, c.fips) for c in counties])
        logger.info("Loaded %d counties", len(lookup))

        total = 0
        failed_years: list[int] = []
        for year in range(start_year, end_year + 1):
            try:
                gaz_year = gazetteer_year_for(year)
                if gaz_year not in gaz_cache:
                    gaz_cache[gaz_year] = fetch_gazetteer_land(gaz_year)
                land = gaz_cache[gaz_year]

                tract_rows = fetch_tract_population(year, api_key)
                rows = aggregate_county_density(tract_rows, land, lookup, year)
                if not rows:
                    logger.info("Year %d: no rows", year)
                    continue
                stmt = pg_insert(TractDensityCountyYear).values(rows)
                stmt = stmt.on_conflict_do_update(
                    constraint="tract_density_county_year_county_code_year_key",
                    set_={
                        "weighted_density": stmt.excluded.weighted_density,
                        "tract_count": stmt.excluded.tract_count,
                    },
                )
                db.execute(stmt)
                db.commit()
                total += len(rows)
                logger.info("Year %d: %d county rows upserted", year, len(rows))
            except Exception as exc:
                db.rollback()
                # An ACS vintage that isn't released yet 404s — that's "not
                # published", not an outage; don't fail the run for it.
                if (
                    isinstance(exc, httpx.HTTPStatusError)
                    and exc.response.status_code == 404
                ):
                    logger.info("ACS %d not published yet (404), skipping", year)
                    continue
                logger.warning("Tract-density year %d failed: %s", year, exc)
                failed_years.append(year)

        if failed_years:
            # Loud partial failure (M-B9 discipline) — same as FARS.
            raise RuntimeError(
                f"Tract density: {len(failed_years)} year(s) failed: {failed_years}"
            )

        logger.info("Done. %d total lived-density rows upserted.", total)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load Census lived-density into Postgres")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
