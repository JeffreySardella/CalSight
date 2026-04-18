"""DMV Vehicle Registration ETL — registered vehicles per county per year.

Fetches vehicle count data from the DMV "Vehicle Fuel Type Count by Zip Code"
dataset on data.ca.gov, aggregates by county, and upserts into the
vehicle_registrations table.

The source data has one row per (zip, model_year, fuel_type, make, duty),
so we sum all vehicles per zip code, then map zip codes to counties using
a Census crosswalk.

Source: CA DMV via data.ca.gov CKAN API
Dataset: "Vehicle Fuel Type Count by Zip Code"

Usage:
    python -m etl.dmv_vehicles
    python -m etl.dmv_vehicles --start 2020 --end 2025
"""

import argparse
import logging
import time
from collections import defaultdict

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import County, VehicleRegistration
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

CKAN_BASE_URL = "https://data.ca.gov/api/3/action/datastore_search"
PAGE_SIZE = 32000
MAX_RETRIES = 3
BACKOFF_BASE = 2

# Resource IDs for each year's dataset on data.ca.gov
RESOURCE_IDS = {
    2019: "d304108a-06c1-462f-a144-981dd0109900",
    2020: "4254a06d-9937-4083-9441-65597dd267e8",
    2021: "888bbb6c-09b4-469c-82e6-1b2a47439736",
    2022: "1856386b-a196-4e7c-be81-44174e29ad50",
    2023: "9aa5b4c5-252c-4d68-b1be-ffe19a2f1d26",
    2024: "d599c3d3-87af-4e8c-8694-9c01f49e3d93",
    2025: "66b0121e-5eab-4fcf-aa0d-2b1dfb5510ab",
    2026: "b459d957-5d94-4b10-999d-770419870364",
}

DEFAULT_START_YEAR = 2019
DEFAULT_END_YEAR = 2026

# California ZIP code to county mapping.
# Built from Census ZCTA-to-county crosswalk. Each zip maps to the county
# containing most of its population. This covers ~95% of CA zip codes.
# Zips not in this map are skipped (out-of-state, PO boxes, etc.)

def _build_zip_to_county_from_db(db) -> dict[str, int]:
    """Build a zip-to-county lookup using the Census crosswalk approach.

    Since zip-to-county mapping is complex (zips can span counties),
    we use a simpler approach: fetch the data grouped by zip, and for
    each zip, look up which county it belongs to using the HUD crosswalk.

    For now, we'll aggregate at the county level by using the first 3
    digits of the zip (SCF) as a rough grouping, then do a proper mapping.

    Actually, the DMV data is already massive — let's just fetch it
    pre-aggregated by summing all vehicles per zip, then map zips to
    counties using a static lookup.
    """
    # We'll build this dynamically from the data itself
    pass


def fetch_and_aggregate_year(year: int, zip_to_county: dict[str, int]) -> dict[int, dict]:
    """Fetch all vehicle records for a year and aggregate to county level.

    Args:
        year: Year to fetch
        zip_to_county: Mapping of zip code string to county_code

    Returns:
        Dict of {county_code: {total_vehicles: int, ev_vehicles: int}}
    """
    resource_id = RESOURCE_IDS[year]
    logger.info("Fetching DMV vehicle data for %d (resource_id=%s)", year, resource_id)

    county_data: dict[int, dict] = defaultdict(lambda: {"total_vehicles": 0, "ev_vehicles": 0})
    offset = 0

    while True:
        params = {
            "resource_id": resource_id,
            "limit": PAGE_SIZE,
            "offset": offset,
        }

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = httpx.get(CKAN_BASE_URL, params=params, timeout=60)
                resp.raise_for_status()
                break
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_error = exc
                if attempt < MAX_RETRIES - 1:
                    wait = BACKOFF_BASE ** (attempt + 1)
                    logger.warning("Attempt %d failed: %s. Retrying in %ds...", attempt + 1, exc, wait)
                    time.sleep(wait)
        else:
            raise last_error

        data = resp.json()
        result = data["result"]
        total = result["total"]
        records = result["records"]

        for rec in records:
            # Field name varies: "ZIP Code" (2024+) vs "Zip Code" (2019-2023)
            zip_code = str(rec.get("ZIP Code", rec.get("Zip Code", ""))).strip()
            county_code = zip_to_county.get(zip_code)
            if county_code is None:
                continue

            try:
                vehicles = int(rec.get("Vehicles", 0))
            except (ValueError, TypeError):
                continue

            county_data[county_code]["total_vehicles"] += vehicles

            fuel = str(rec.get("Fuel", "")).strip()
            if fuel in ("Battery Electric", "Plug-in Hybrid"):
                county_data[county_code]["ev_vehicles"] += vehicles

        offset += len(records)
        logger.info("Year %d: processed %d/%d records", year, offset, total)

        if offset >= total or len(records) == 0:
            break

    return dict(county_data)


def build_zip_to_county_mapping() -> dict[str, int]:
    """Build a California zip code to county_code mapping.

    Uses the HUD USPS ZIP Crosswalk via a Census-based approach.
    Since we can't easily call the HUD API, we use a static mapping
    derived from the Census ZCTA relationships file.

    For simplicity, we fetch a small mapping from a public source.
    """
    logger.info("Building zip-to-county mapping...")

    # Use the Census geocoder to map zips, or use HUD crosswalk
    # For now, use the relationship file approach
    url = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"

    try:
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
    except Exception as exc:
        logger.error("Failed to download Census ZCTA-county crosswalk: %s", exc)
        return {}

    lines = resp.text.strip().split("\n")
    header = lines[0].split("|")

    # Find column indices
    zcta_idx = header.index("GEOID_ZCTA5_20")
    state_idx = header.index("GEOID_COUNTY_20")
    pop_idx = header.index("AREALAND_PART")  # use land area as tiebreaker

    # For each zip, pick the county with the largest overlap area
    zip_best: dict[str, tuple[str, int]] = {}  # zip -> (county_fips, area)

    for line in lines[1:]:
        parts = line.split("|")
        if len(parts) <= max(zcta_idx, state_idx, pop_idx):
            continue

        zcta = parts[zcta_idx]
        county_fips = parts[state_idx]  # full 5-digit FIPS

        # Only California (state FIPS 06)
        if not county_fips.startswith("06"):
            continue

        try:
            area = int(parts[pop_idx])
        except ValueError:
            area = 0

        if zcta not in zip_best or area > zip_best[zcta][1]:
            zip_best[zcta] = (county_fips, area)

    # Now map county FIPS to our county_code
    db = SessionLocal()
    counties = db.query(County.code, County.fips).all()
    fips_to_code = {c.fips: c.code for c in counties if c.fips}
    db.close()

    zip_to_county = {}
    for zcta, (county_fips, _) in zip_best.items():
        code = fips_to_code.get(county_fips)
        if code is not None:
            zip_to_county[zcta] = code

    logger.info("Mapped %d California zip codes to counties", len(zip_to_county))
    return zip_to_county


@track_etl_run("vehicle_registrations")
def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Main entry point."""
    zip_to_county = build_zip_to_county_mapping()
    if not zip_to_county:
        logger.error("No zip-to-county mapping available. Aborting.")
        return

    db = SessionLocal()

    try:
        total_rows = 0

        for year in range(start_year, end_year + 1):
            if year not in RESOURCE_IDS:
                logger.info("No resource ID for year %d, skipping", year)
                continue

            try:
                county_data = fetch_and_aggregate_year(year, zip_to_county)

                rows = [
                    {
                        "county_code": code,
                        "year": year,
                        "total_vehicles": data["total_vehicles"],
                        "ev_vehicles": data["ev_vehicles"],
                    }
                    for code, data in county_data.items()
                ]

                if rows:
                    stmt = pg_insert(VehicleRegistration).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        constraint="vehicle_registrations_county_code_year_key",
                        set_={
                            "total_vehicles": stmt.excluded.total_vehicles,
                            "ev_vehicles": stmt.excluded.ev_vehicles,
                        },
                    )
                    db.execute(stmt)
                    db.commit()
                    total_rows += len(rows)
                    logger.info("Year %d: %d counties upserted", year, len(rows))

            except Exception as exc:
                logger.error("Year %d failed: %s", year, exc)
                db.rollback()

        logger.info("Done. %d total vehicle registration records upserted.", total_rows)

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Load DMV vehicle registration data into Postgres"
    )
    parser.add_argument("--start", type=int, default=DEFAULT_START_YEAR)
    parser.add_argument("--end", type=int, default=DEFAULT_END_YEAR)
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
