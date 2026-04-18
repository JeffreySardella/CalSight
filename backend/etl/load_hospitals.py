"""California hospitals and trauma centers ETL.

Fetches licensed healthcare facility data from data.ca.gov, filters to
hospitals (General Acute Care, etc.), and loads into the hospitals table.

Enables crash severity analysis: distance to nearest trauma center,
coverage gaps, and correlation between proximity and fatality rates.

Source: CA HCAI "Licensed and Certified Healthcare Facility Listing"
CKAN resource ID: 3d2503d7-56ad-4f38-8435-3d86d27b7407

Usage:
    python -m etl.load_hospitals
"""

import logging

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import County, Hospital
from etl._utils import get_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

CKAN_BASE_URL = "https://data.ca.gov/api/3/action/datastore_search"
RESOURCE_ID = "3d2503d7-56ad-4f38-8435-3d86d27b7407"
PAGE_SIZE = 5000

# Facility types that are hospitals (not nursing homes, clinics, etc.)
HOSPITAL_TYPES = {
    "GENERAL ACUTE CARE HOSPITAL",
    "ACUTE PSYCHIATRIC HOSPITAL",
    "ACUTE CARE CHILDREN'S HOSPITAL",
}


def _safe_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _safe_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


@track_etl_run("hospitals")
def run():
    """Main entry point."""
    db = SessionLocal()

    try:
        # Build county name -> code lookup
        counties = db.query(County.name, County.code).all()
        name_to_code = {}
        for name, code in counties:
            name_to_code[name.upper()] = code
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
                fac_type = str(rec.get("FAC_FDR", "")).strip().upper()
                if fac_type not in HOSPITAL_TYPES:
                    continue

                status = str(rec.get("FAC_STATUS_TYPE_CODE", "")).strip().upper()
                county_name = str(rec.get("COUNTY_NAME", "")).strip().upper()
                county_code = name_to_code.get(county_name)
                if county_code is None:
                    continue

                facility_id = str(rec.get("FACID", "")).strip()
                if not facility_id:
                    continue

                trauma = rec.get("TRAUMA_CTR")
                trauma_ped = rec.get("TRAUMA_PED_CTR")

                all_rows.append({
                    "facility_id": facility_id,
                    "facility_name": str(rec.get("FACNAME", "")).strip()[:200],
                    "facility_type": fac_type[:100],
                    "county_code": county_code,
                    "city": str(rec.get("CITY", "")).strip()[:100] or None,
                    "address": str(rec.get("ADDRESS", "")).strip()[:200] or None,
                    "latitude": _safe_float(rec.get("LATITUDE")),
                    "longitude": _safe_float(rec.get("LONGITUDE")),
                    "bed_capacity": _safe_int(rec.get("CAPACITY")),
                    "trauma_center": str(trauma).strip()[:50] if trauma else None,
                    "trauma_pediatric": str(trauma_ped).strip()[:50] if trauma_ped else None,
                    "status": status[:20],
                })

            offset += len(records)
            logger.info("Fetched %d/%d records (%d hospitals so far)", offset, total, len(all_rows))

            if offset >= total or len(records) == 0:
                break

        logger.info("Total hospitals: %d", len(all_rows))

        # Bulk upsert
        if all_rows:
            batch_size = 500
            for i in range(0, len(all_rows), batch_size):
                batch = all_rows[i : i + batch_size]
                stmt = pg_insert(Hospital).values(batch)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["facility_id"],
                    set_={
                        "facility_name": stmt.excluded.facility_name,
                        "facility_type": stmt.excluded.facility_type,
                        "county_code": stmt.excluded.county_code,
                        "city": stmt.excluded.city,
                        "address": stmt.excluded.address,
                        "latitude": stmt.excluded.latitude,
                        "longitude": stmt.excluded.longitude,
                        "bed_capacity": stmt.excluded.bed_capacity,
                        "trauma_center": stmt.excluded.trauma_center,
                        "trauma_pediatric": stmt.excluded.trauma_pediatric,
                        "status": stmt.excluded.status,
                    },
                )
                db.execute(stmt)
                db.commit()

        logger.info("Done. %d hospital records upserted.", len(all_rows))

    finally:
        db.close()


if __name__ == "__main__":
    run()
