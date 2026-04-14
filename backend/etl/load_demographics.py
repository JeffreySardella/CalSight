"""ETL orchestrator: load Census ACS demographics into Postgres.

This is the main script you run to populate the demographics table.
It coordinates everything:
  1. Reads the county FIPS lookup from Postgres
  2. Loops through each year (2005-2022)
  3. Calls the Census API client for each year
  4. Transforms the data to match our Demographic model
  5. Upserts (insert-or-update) into the database

"Upsert" means: if a row for (county, year) already exists, update it.
If not, insert a new one. This makes the script safe to re-run — you
won't get duplicate rows.

Usage:
    python -m etl.load_demographics
    python -m etl.load_demographics --start 2020 --end 2022
"""

import argparse
import logging
import sys

from sqlalchemy import select

from app.database import SessionLocal
from app.models import County, Demographic
from app.settings import settings
from etl.census_api import fetch_county_demographics

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

DEFAULT_START_YEAR = 2005
DEFAULT_END_YEAR = 2022


def build_fips_lookup(county_rows: list[tuple]) -> dict[str, int]:
    """Build a mapping from 3-digit FIPS suffix to county_code.

    Why this is needed:
    - Census API returns county as 3 digits: "001" (Alameda)
    - Our counties table stores 5-digit FIPS: "06001"
    - Our Demographic table uses county_code: 1

    So we need: "001" -> 1

    Args:
        county_rows: List of (code, fips) tuples from counties table.
    """
    lookup = {}
    for code, fips in county_rows:
        if fips is None:
            continue
        # "06001" -> last 3 chars -> "001"
        suffix = fips[-3:]
        lookup[suffix] = code
    return lookup


def transform_to_demographic_kwargs(
    api_row: dict, fips_lookup: dict[str, int], year: int
) -> dict | None:
    """Transform one Census API row into kwargs for the Demographic model.

    This is the "T" in ETL — taking data shaped one way (Census format)
    and reshaping it for our database.

    Returns None if the county FIPS isn't in our lookup (skip it).
    """
    county_fips = api_row["county_fips"]
    county_code = fips_lookup.get(county_fips)
    if county_code is None:
        return None

    return {
        "county_code": county_code,
        "year": year,
        "population": api_row.get("population"),
        "median_age": api_row.get("median_age"),
        "median_income": api_row.get("median_income"),
        "commute_drive_alone_pct": api_row.get("commute_drive_alone_pct"),
        "commute_carpool_pct": api_row.get("commute_carpool_pct"),
        "commute_transit_pct": api_row.get("commute_transit_pct"),
        "commute_walk_pct": api_row.get("commute_walk_pct"),
        "commute_bike_pct": api_row.get("commute_bike_pct"),
        "commute_wfh_pct": api_row.get("commute_wfh_pct"),
    }


def upsert_demographics(session, rows: list[dict]) -> tuple[int, int]:
    """Insert new rows or update existing ones.

    "Upsert" = "insert or update". We check if a row with this
    (county_code, year) already exists:
    - Yes: update its values (in case Census revised the data)
    - No: insert a new row

    This makes the script idempotent — run it 10 times, same result.
    """
    inserted = 0
    updated = 0
    for kwargs in rows:
        existing = session.query(Demographic).filter_by(
            county_code=kwargs["county_code"],
            year=kwargs["year"],
        ).first()

        if existing:
            for key, value in kwargs.items():
                setattr(existing, key, value)
            updated += 1
        else:
            session.add(Demographic(**kwargs))
            inserted += 1

    session.commit()
    return inserted, updated


def run(start_year: int = DEFAULT_START_YEAR, end_year: int = DEFAULT_END_YEAR):
    """Main ETL entry point."""
    api_key = settings.census_api_key
    if not api_key:
        logger.error("CENSUS_API_KEY is not set. Add it to backend/.env")
        sys.exit(1)

    db = SessionLocal()
    try:
        # Step 1: Build the FIPS -> county_code lookup from the DB
        county_rows = db.execute(
            select(County.code, County.fips)
        ).all()
        fips_lookup = build_fips_lookup(county_rows)
        logger.info("Loaded %d counties from database", len(fips_lookup))

        if len(fips_lookup) == 0:
            logger.error(
                "No counties in database. Run: python -m app.seed_counties"
            )
            sys.exit(1)

        total_inserted = 0
        total_updated = 0
        failed_years = []

        # Step 2: Loop through each year
        for year in range(start_year, end_year + 1):
            try:
                # Step 3: Fetch from Census API
                api_rows = fetch_county_demographics(year, api_key)

                # Step 4: Transform each row
                kwargs_list = []
                for row in api_rows:
                    kwargs = transform_to_demographic_kwargs(
                        row, fips_lookup, year
                    )
                    if kwargs is not None:
                        kwargs_list.append(kwargs)

                # Step 5: Upsert into Postgres
                inserted, updated = upsert_demographics(db, kwargs_list)
                total_inserted += inserted
                total_updated += updated
                logger.info(
                    "Year %d: %d inserted, %d updated",
                    year, inserted, updated,
                )
            except Exception as exc:
                failed_years.append(year)
                logger.error("Year %d failed: %s", year, exc)
                # Rollback this year's partial writes, then continue
                db.rollback()

        # Summary
        logger.info(
            "Done. %d inserted, %d updated, %d years failed %s",
            total_inserted,
            total_updated,
            len(failed_years),
            failed_years if failed_years else "",
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Load Census ACS demographics into Postgres"
    )
    parser.add_argument(
        "--start", type=int, default=DEFAULT_START_YEAR,
        help=f"Start year (default: {DEFAULT_START_YEAR})",
    )
    parser.add_argument(
        "--end", type=int, default=DEFAULT_END_YEAR,
        help=f"End year (default: {DEFAULT_END_YEAR})",
    )
    args = parser.parse_args()
    run(start_year=args.start, end_year=args.end)
