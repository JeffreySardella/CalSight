"""Pull CalEnviroScreen 5.0 environmental justice scores from OEHHA.

CalEnviroScreen is California's tool for identifying communities that
are most affected by pollution and poverty. The raw data is at the
census tract level (~9,100 tracts on 2020 census geography) so we
average it up to county level using population weighting. That way we
can compare environmental burden across counties alongside crash data.

The data lives on an ArcGIS server. We page through it 2,000 tracts
at a time, then do the aggregation in Python.

The raw tract rows are also kept, in `tract_ces` — the equity map layer
shades individual tracts, and the county average can't be un-averaged.

Source: https://oehha.ca.gov/calenviroscreen

Usage:
    python -m etl.load_calenviroscreen
"""

import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, CalenviroScreen, TractCes
from etl._utils import get_with_retry, require_rows, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# The CalEnviroScreen data lives on an ArcGIS server run by OEHHA.
# We hit it like a REST API — query with "where 1=1" (give me everything)
# and page through in batches of 2,000 records.
# This is the final CES 5.0 results layer published 2026-07-01
# ("_F_070126" = Final, July 1 2026).
ARCGIS_SERVICE = (
    "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services"
    "/calenviroscreen50results_F_070126_gdb/FeatureServer"
)
# The layer is looked up by name, not by id: OEHHA republished this service in
# September 2026 and the results moved from layer 0 to layer 2, which turned
# every query into an "Invalid URL" error body.
LAYER_NAME = "CalEnviroScreen 5.0 Results"

# The census population field used for weighting. CES 4.0 called this
# "ACS2019TotalPop"; CES 5.0 renamed it to "Population" (ACS 2024).
POPULATION_FIELD = "Population"

# Fields we need from the ArcGIS response. CES 5.0 renamed most of the
# cryptic 4.0 short names (pm, diesel, pov, ...) to fuller ones.
OUT_FIELDS = ",".join([
    "tract", POPULATION_FIELD,
    "CIscore", "CIscoreP",
    "PollutionScore", "PopCharScore",
    "PM2_5", "ozone", "Diesel_PM", "Pesticides", "traffic",
    "Poverty", "Unemployment", "Education", "Linguistic_Isol", "HousBurd",
])

# Maps the ArcGIS field names to our database column names.
# "PM2_5" is PM2.5 particulate matter, "Linguistic_Isol" is linguistic
# isolation, "HousBurd" is housing burden, etc.
FIELD_MAP = {
    "CIscore": "ces_score",
    "CIscoreP": "ces_percentile",
    "PollutionScore": "pollution_burden",
    "PopCharScore": "pop_characteristics",
    "PM2_5": "pm25_score",
    "ozone": "ozone_score",
    "Diesel_PM": "diesel_pm_score",
    "Pesticides": "pesticide_score",
    "traffic": "traffic_score",
    "Poverty": "poverty_pct",
    "Unemployment": "unemployment_pct",
    "Education": "education_pct",
    "Linguistic_Isol": "linguistic_isolation_pct",
    "HousBurd": "housing_burden_pct",
}


def _safe_float(value):
    """Convert a value to float, returning None for missing data."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def normalize_geoid(tract_code) -> str | None:
    """Return the 11-digit census GEOID for a raw CES `tract` value.

    ArcGIS hands the tract back as a number, so California's leading zero is
    gone ("6001400100"). Pad it back — the Census boundary file joins on the
    11-digit string form.
    """
    if tract_code is None:
        return None
    try:
        tract_str = str(int(tract_code))
    except (TypeError, ValueError):
        return None
    if len(tract_str) == 10:
        tract_str = "0" + tract_str
    return tract_str if len(tract_str) == 11 else None


def build_tract_rows(
    tracts: list[dict], fips_to_code: dict[str, int]
) -> list[dict]:
    """Shape the raw CES tract records into `tract_ces` rows.

    Keeps the tract grain the county aggregation throws away. Tracts with an
    unparseable GEOID, or one whose county FIPS isn't a CA county we know,
    are dropped — county_code is a FK.
    """
    rows: list[dict] = []
    seen: set[str] = set()
    for tract in tracts:
        geoid = normalize_geoid(tract.get("tract"))
        if geoid is None or geoid in seen:
            continue
        county_code = fips_to_code.get(geoid[:5])
        if county_code is None:
            continue
        seen.add(geoid)

        pop = _safe_float(tract.get(POPULATION_FIELD))
        rows.append({
            "geoid": geoid,
            "county_code": county_code,
            "ces_score": _safe_float(tract.get("CIscore")),
            "ces_percentile": _safe_float(tract.get("CIscoreP")),
            "pollution_burden": _safe_float(tract.get("PollutionScore")),
            "pop_characteristics": _safe_float(tract.get("PopCharScore")),
            "population": int(pop) if pop is not None and pop >= 0 else None,
        })
    return rows


def resolve_layer_id() -> int:
    """Find the results layer's id in the feature service by its name."""
    info = get_with_retry(f"{ARCGIS_SERVICE}?f=json", timeout=60.0).json()
    if "error" in info:
        raise RuntimeError(f"CalEnviroScreen service lookup failed: {info['error']}")
    for layer in info.get("layers", []):
        if layer.get("name") == LAYER_NAME:
            return int(layer["id"])
    names = [layer.get("name") for layer in info.get("layers", [])]
    raise RuntimeError(f"CalEnviroScreen layer {LAYER_NAME!r} not found; service has {names}")


def fetch_tracts() -> list[dict]:
    """Download all ~9,100 census tract records from the ArcGIS server.

    ArcGIS caps you at about 2,000 records per request, so we page
    through using resultOffset. Usually takes 4-5 requests to get
    everything. Each request takes a couple seconds.
    """
    query_url = f"{ARCGIS_SERVICE}/{resolve_layer_id()}/query"
    all_records = []
    offset = 0
    batch_size = 2000

    while True:
        url = (
            f"{query_url}?where=1%3D1"
            f"&outFields={OUT_FIELDS}"
            f"&resultRecordCount={batch_size}"
            f"&resultOffset={offset}"
            f"&f=json"
        )
        logger.info("Fetching CES tracts (offset=%d)", offset)
        resp = get_with_retry(url, timeout=60.0)
        data = resp.json()
        # ArcGIS reports failures as a 200 with an "error" body. Reading that
        # as "no more features" is how a moved layer loaded zero rows silently.
        if "error" in data:
            raise RuntimeError(f"CalEnviroScreen query failed: {data['error']}")

        features = data.get("features", [])
        if not features:
            break

        for f in features:
            all_records.append(f.get("attributes", {}))

        offset += len(features)

        # If we got fewer than batch_size, we've reached the end
        if len(features) < batch_size:
            break

    logger.info("Fetched %d census tract records", len(all_records))
    return all_records


def aggregate_to_counties(tracts: list[dict], fips_to_code: dict[str, int]) -> dict:
    """Average ~9,100 census tracts up to 58 counties.

    Each tract has scores for pollution, poverty, etc. We want county-level
    numbers, but you can't just take a simple average because tracts have
    different populations. A tract with 10,000 people should count more
    than one with 500. So we use population-weighted averages:

        county_score = sum(tract_score * tract_pop) / sum(tract_pop)

    The tract FIPS code tells us which county it's in. Census tract codes
    are 11 digits — first 5 are the county (e.g., 06001 = Alameda).
    Some tracts come in as 10-digit numbers (missing the leading 0) so
    we pad those.
    """
    county_data = {}

    for tract in tracts:
        # Extract county FIPS from census tract code
        tract_str = normalize_geoid(tract.get("tract"))
        if tract_str is None:
            continue

        county_fips = tract_str[:5]  # "06001" for Alameda
        county_code = fips_to_code.get(county_fips)
        if county_code is None:
            continue

        pop = _safe_float(tract.get(POPULATION_FIELD))
        if pop is None or pop <= 0:
            continue

        if county_code not in county_data:
            county_data[county_code] = {
                "total_pop": 0,
                "tract_count": 0,
                "weighted_sums": {field: 0.0 for field in FIELD_MAP.values()},
                "valid_weights": {field: 0.0 for field in FIELD_MAP.values()},
            }

        entry = county_data[county_code]
        entry["total_pop"] += pop
        entry["tract_count"] += 1

        for source_col, target_field in FIELD_MAP.items():
            val = _safe_float(tract.get(source_col))
            if val is not None:
                entry["weighted_sums"][target_field] += val * pop
                entry["valid_weights"][target_field] += pop

    # Compute weighted averages
    results = {}
    for county_code, entry in county_data.items():
        row = {
            "county_code": county_code,
            "tract_count": entry["tract_count"],
            "total_population": int(entry["total_pop"]),
        }
        for field in FIELD_MAP.values():
            denom = entry["valid_weights"][field]
            if denom > 0:
                row[field] = round(entry["weighted_sums"][field] / denom, 2)
            else:
                row[field] = None
        results[county_code] = row

    return results


@track_etl_run("calenviroscreen")
def run():
    """Main ETL entry point."""
    db = SessionLocal()
    try:
        counties = db.execute(select(County.code, County.fips)).all()
        fips_to_code = {c.fips: c.code for c in counties if c.fips}
        logger.info("Loaded %d counties", len(fips_to_code))

        tracts = fetch_tracts()
        # Same zero-row guard the county aggregate gets below, but one step
        # earlier: the tract upsert runs first, so an empty or malformed
        # upstream has to fail here rather than log "0 tract_ces rows" and
        # let the run look successful.
        require_rows(tracts, "calenviroscreen", "CES tract records")

        # Keep the tract grain too (the equity map layer reads it). Written
        # before the county aggregate so a tract-side failure can't leave the
        # county averages half-updated.
        tract_rows = build_tract_rows(tracts, fips_to_code)
        if tract_rows:
            stmt = pg_insert(TractCes).values(tract_rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["geoid"],
                set_={
                    c: stmt.excluded[c]
                    for c in (
                        "county_code", "ces_score", "ces_percentile",
                        "pollution_burden", "pop_characteristics", "population",
                    )
                },
            )
            db.execute(stmt)
            db.commit()
        logger.info("Upserted %d tract_ces rows", len(tract_rows))

        county_scores = aggregate_to_counties(tracts, fips_to_code)
        logger.info("Aggregated to %d counties", len(county_scores))
        require_rows(county_scores, "calenviroscreen", "county-aggregated CES rows")

        inserted = 0
        updated = 0
        for county_code, row in county_scores.items():
            existing = db.query(CalenviroScreen).filter_by(
                county_code=county_code
            ).first()

            if existing:
                for key, value in row.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                db.add(CalenviroScreen(**row))
                inserted += 1

        db.commit()
        logger.info("Done. %d inserted, %d updated", inserted, updated)
    finally:
        db.close()


if __name__ == "__main__":
    run()
