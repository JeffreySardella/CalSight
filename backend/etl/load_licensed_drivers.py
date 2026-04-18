"""Pull licensed driver counts per county from the DMV on data.ca.gov.

This gives us the denominator for "crashes per 10K licensed drivers"
which is how most safety orgs report crash rates. Without this you
can only do per-capita which isn't as meaningful since not everyone
drives.

The DMV dataset is a little annoying — it's in wide format where
each year is a column instead of a row. So we pivot it. Also the
county names have trailing whitespace for some reason. And there
are summary rows at the bottom (TOTAL, OUT OF STATE, ID CARDS) that
need to be filtered out.

Source: https://data.ca.gov/dataset/driver-licenses-outstanding-by-county

Usage:
    python -m etl.load_licensed_drivers
"""

import logging

from sqlalchemy import select

from app.database import SessionLocal
from app.models import County, LicensedDriver
from etl._utils import get_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

RESOURCE_ID = "0abef7f0-285f-4887-9b4e-69e86d89ceb1"
CKAN_URL = (
    f"https://data.ca.gov/api/3/action/datastore_search"
    f"?resource_id={RESOURCE_ID}&limit=100"
)

# Rows to skip (not real counties)
SKIP_ROWS = {"OUT OF STATE", "TOTAL", "ID CARDS OUTSTANDING"}


def fetch_records() -> list[dict]:
    """Grab all 61 rows from data.ca.gov in one request.

    The dataset is tiny — 58 counties plus 3 summary rows. We just
    fetch them all at once with limit=100.
    """
    resp = get_with_retry(CKAN_URL, timeout=30.0)
    return resp.json()["result"]["records"]


def transform_wide_to_long(records: list[dict], name_to_code: dict[str, int]) -> list[dict]:
    """Turn the DMV's wide-format table into rows we can store.

    The DMV dataset is annoying — instead of having year as a column,
    each year IS a column. So it looks like:

        COUNTIES  | 2008    | 2009    | ... | 2024
        ALAMEDA   | 986845  | 990123  | ... | 1161029

    We need to turn that into:
        county_code=1, year=2008, driver_count=986845
        county_code=1, year=2009, driver_count=990123
        ...

    Also the county names have trailing whitespace ("ALPINE  ") and
    there are 3 summary rows at the bottom (TOTAL, OUT OF STATE,
    ID CARDS OUTSTANDING) that we skip.
    """
    rows = []
    for rec in records:
        county_name = str(rec.get("COUNTIES", "")).strip().upper()
        if county_name in SKIP_ROWS or not county_name:
            continue

        # Map county name to code (handle title case in our DB)
        county_code = name_to_code.get(county_name)
        if county_code is None:
            continue

        # Each numeric key is a year column
        for key, value in rec.items():
            if key.startswith("_") or key == "COUNTIES":
                continue
            try:
                year = int(key)
            except ValueError:
                continue

            if value is None or value == "":
                continue
            try:
                count = int(float(str(value).replace(",", "")))
            except (ValueError, TypeError):
                continue

            rows.append({
                "county_code": county_code,
                "year": year,
                "driver_count": count,
            })

    return rows


@track_etl_run("licensed_drivers")
def run():
    """Main ETL entry point."""
    db = SessionLocal()
    try:
        # Build county name -> code lookup
        counties = db.execute(select(County.code, County.name)).all()
        name_to_code = {c.name.upper(): c.code for c in counties}
        logger.info("Loaded %d counties", len(name_to_code))

        records = fetch_records()
        logger.info("Fetched %d rows from CKAN", len(records))

        rows = transform_wide_to_long(records, name_to_code)
        logger.info("Transformed to %d (county, year) rows", len(rows))

        inserted = 0
        updated = 0
        for row in rows:
            existing = db.query(LicensedDriver).filter_by(
                county_code=row["county_code"],
                year=row["year"],
            ).first()

            if existing:
                existing.driver_count = row["driver_count"]
                updated += 1
            else:
                db.add(LicensedDriver(**row))
                inserted += 1

        db.commit()
        logger.info("Done. %d inserted, %d updated", inserted, updated)
    finally:
        db.close()


if __name__ == "__main__":
    run()
