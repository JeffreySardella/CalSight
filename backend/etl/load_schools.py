"""CA Dept of Education school locations ETL.

Fetches California public school data from data.ca.gov and loads
active schools with their lat/long into the school_locations table.

Enables "crashes near schools" analysis and school-zone safety metrics.

Source: CA Dept of Education "California Public Schools 2024-25" on data.ca.gov
CKAN resource ID: 23740f30-e860-4ada-a7cb-8de6d21e2c78

Usage:
    python -m etl.load_schools
"""

import logging

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import County, SchoolLocation
from etl._utils import get_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

CKAN_BASE_URL = "https://data.ca.gov/api/3/action/datastore_search"
RESOURCE_ID = "23740f30-e860-4ada-a7cb-8de6d21e2c78"
PAGE_SIZE = 5000


def _safe_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


@track_etl_run("schools")
def run():
    """Main entry point."""
    db = SessionLocal()

    try:
        # Build county name -> code lookup
        counties = db.query(County.name, County.code).all()
        name_to_code = {name: code for name, code in counties}
        logger.info("Loaded %d counties", len(name_to_code))

        all_rows = []
        offset = 0

        while True:
            params = {
                "resource_id": RESOURCE_ID,
                "limit": PAGE_SIZE,
                "offset": offset,
            }
            resp = get_with_retry(CKAN_BASE_URL, params=params, timeout=60)

            data = resp.json()
            result = data["result"]
            total = result["total"]
            records = result["records"]

            for rec in records:
                status = str(rec.get("Status", "")).strip()
                if status != "Active":
                    continue

                county_name = str(rec.get("County Name", "")).strip()
                county_code = name_to_code.get(county_name)
                if county_code is None:
                    continue

                cds_code = str(rec.get("CDS Code", "")).strip()
                if not cds_code:
                    continue

                all_rows.append({
                    "cds_code": cds_code,
                    "school_name": str(rec.get("School Name", "")).strip()[:200],
                    "county_code": county_code,
                    "city": str(rec.get("City", "")).strip()[:100] or None,
                    "latitude": _safe_float(rec.get("Latitude")),
                    "longitude": _safe_float(rec.get("Longitude")),
                    "school_type": str(rec.get("School Type", "")).strip()[:50] or None,
                    "status": status,
                })

            offset += len(records)
            logger.info("Fetched %d/%d records (%d active so far)", offset, total, len(all_rows))

            if offset >= total or len(records) == 0:
                break

        logger.info("Total active schools: %d", len(all_rows))

        # Bulk upsert in batches
        batch_size = 1000
        for i in range(0, len(all_rows), batch_size):
            batch = all_rows[i : i + batch_size]
            stmt = pg_insert(SchoolLocation).values(batch)
            stmt = stmt.on_conflict_do_update(
                index_elements=["cds_code"],
                set_={
                    "school_name": stmt.excluded.school_name,
                    "county_code": stmt.excluded.county_code,
                    "city": stmt.excluded.city,
                    "latitude": stmt.excluded.latitude,
                    "longitude": stmt.excluded.longitude,
                    "school_type": stmt.excluded.school_type,
                    "status": stmt.excluded.status,
                },
            )
            db.execute(stmt)
            db.commit()

        logger.info("Done. %d school locations upserted.", len(all_rows))

    finally:
        db.close()


if __name__ == "__main__":
    run()
