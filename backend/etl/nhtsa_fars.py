"""NHTSA FARS ETL — fatal-crash aggregates per California county per year.

Downloads the yearly FARS National CSV bundle, reads accident/person tables,
filters to California (STATE=6), and upserts per-county fatality + restraint
counts into fars_county_year. The frontend derives pct_unrestrained.

Source: NHTSA FARS  https://static.nhtsa.gov/nhtsa/downloads/FARS/

Usage:
    python -m etl.nhtsa_fars
    python -m etl.nhtsa_fars --start 2018 --end 2022
"""

import argparse
import csv
import io
import logging
import zipfile
from collections import defaultdict

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal
from app.models import County, FarsCountyYear
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2001
DEFAULT_END_YEAR = 2025
CA_STATE_FIPS = "6"

# REST_USE classification (best-effort, FARS codes drift across years).
UNRESTRAINED_CODES = {"0"}
UNKNOWN_RESTRAINT_CODES = {"8", "9", "96", "97", "98", "99", ""}

FARS_ZIP_URL = (
    "https://static.nhtsa.gov/nhtsa/downloads/FARS/"
    "{year}/National/FARS{year}NationalCSV.zip"
)
MAX_RETRIES = 3
BACKOFF_BASE = 2


def build_county_lookup(counties: list[tuple[int, str | None]]) -> dict[int, int]:
    """Map 3-digit within-state FIPS -> county_code from (code, fips) pairs."""
    lookup: dict[int, int] = {}
    for code, fips in counties:
        if not fips or len(fips) < 3:
            continue
        lookup[int(fips[-3:])] = code
    return lookup


def aggregate_fars(
    person_rows: list[dict], county_lookup: dict[int, int], year: int
) -> list[dict]:
    """Aggregate FARS person rows to per-county fatality + restraint counts."""
    tally: dict[int, dict[str, int]] = defaultdict(
        lambda: {"fatalities": 0, "unrestrained_killed": 0, "restraint_known_killed": 0}
    )
    for r in person_rows:
        if str(r.get("STATE")) != CA_STATE_FIPS:
            continue
        if str(r.get("INJ_SEV")) != "4":  # 4 == Fatal Injury (killed)
            continue
        try:
            county = int(r.get("COUNTY"))
        except (TypeError, ValueError):
            continue
        code = county_lookup.get(county)
        if code is None:
            continue
        rest = str(r.get("REST_USE", "")).strip()
        t = tally[code]
        t["fatalities"] += 1
        if rest not in UNKNOWN_RESTRAINT_CODES:
            t["restraint_known_killed"] += 1
        if rest in UNRESTRAINED_CODES:
            t["unrestrained_killed"] += 1

    return [
        {"county_code": code, "year": year, **counts}
        for code, counts in sorted(tally.items())
    ]


def fetch_year(year: int) -> list[dict]:
    """Download a FARS year bundle and return California person rows.

    Reads person.csv from the zip, filtering STATE==6 while parsing to keep
    memory small. Returns raw dict rows for aggregate_fars().
    """
    url = FARS_ZIP_URL.format(year=year)
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = httpx.get(url, timeout=120, follow_redirects=True)
            resp.raise_for_status()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                import time
                time.sleep(BACKOFF_BASE ** (attempt + 1))
    else:
        logger.error("All retries failed for FARS %d", year)
        raise last_error

    rows: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        name = next(
            (n for n in zf.namelist() if n.lower().endswith("person.csv")), None
        )
        if name is None:
            logger.warning("No person.csv in FARS %d bundle", year)
            return rows
        with zf.open(name) as fh:
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            for r in csv.DictReader(text):
                if str(r.get("STATE")) == CA_STATE_FIPS:
                    rows.append(r)
    return rows


@track_etl_run("fars")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Fetch + aggregate + upsert FARS county/year rows for CA."""
    db = SessionLocal()
    try:
        counties = db.query(County.code, County.fips).all()
        lookup = build_county_lookup([(c.code, c.fips) for c in counties])
        logger.info("Loaded %d counties", len(lookup))

        total = 0
        for year in range(start_year, end_year + 1):
            try:
                person_rows = fetch_year(year)
                rows = aggregate_fars(person_rows, lookup, year)
                if not rows:
                    logger.info("Year %d: no rows", year)
                    continue
                stmt = pg_insert(FarsCountyYear).values(rows)
                stmt = stmt.on_conflict_do_update(
                    constraint="fars_county_year_county_code_year_key",
                    set_={
                        "fatalities": stmt.excluded.fatalities,
                        "unrestrained_killed": stmt.excluded.unrestrained_killed,
                        "restraint_known_killed": stmt.excluded.restraint_known_killed,
                    },
                )
                db.execute(stmt)
                db.commit()
                total += len(rows)
                logger.info("Year %d: %d county rows upserted", year, len(rows))
            except Exception as exc:
                logger.warning("FARS year %d failed: %s", year, exc)
                db.rollback()

        logger.info("Done. %d total FARS county/year rows upserted.", total)
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load NHTSA FARS data into Postgres")
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
