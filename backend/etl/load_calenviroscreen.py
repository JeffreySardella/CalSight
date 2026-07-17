"""Pull CalEnviroScreen 5.0 environmental justice scores from OEHHA.

CalEnviroScreen is California's tool for identifying communities that
are most affected by pollution and poverty. The raw data is at the
census tract level (~9,100 tracts on 2020 census geography) so we
average it up to county level using population weighting. That way we
can compare environmental burden across counties alongside crash data.

The data lives on an ArcGIS server. We page through it 2,000 tracts
at a time, then do the aggregation in Python.

Source: https://oehha.ca.gov/calenviroscreen

Usage:
    python -m etl.load_calenviroscreen
"""

import logging

from sqlalchemy import select

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, CalenviroScreen
from etl._utils import get_with_retry, track_etl_run

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
ARCGIS_BASE = (
    "https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services"
    "/calenviroscreen50results_F_070126_gdb/FeatureServer/0/query"
)

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


def fetch_tracts() -> list[dict]:
    """Download all ~9,100 census tract records from the ArcGIS server.

    ArcGIS caps you at about 2,000 records per request, so we page
    through using resultOffset. Usually takes 4-5 requests to get
    everything. Each request takes a couple seconds.
    """
    all_records = []
    offset = 0
    batch_size = 2000

    while True:
        url = (
            f"{ARCGIS_BASE}?where=1%3D1"
            f"&outFields={OUT_FIELDS}"
            f"&resultRecordCount={batch_size}"
            f"&resultOffset={offset}"
            f"&f=json"
        )
        logger.info("Fetching CES tracts (offset=%d)", offset)
        resp = get_with_retry(url, timeout=60.0)
        data = resp.json()

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
        tract_code = tract.get("tract")
        if tract_code is None:
            continue
        tract_str = str(int(tract_code))

        # Tract codes are 11 digits (06CCCTTTTTTT), pad if needed
        if len(tract_str) == 10:
            tract_str = "0" + tract_str  # e.g., 6001400100 -> 06001400100

        if len(tract_str) < 5:
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
        county_scores = aggregate_to_counties(tracts, fips_to_code)
        logger.info("Aggregated to %d counties", len(county_scores))

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
