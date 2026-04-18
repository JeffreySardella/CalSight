"""Pull road miles per county from Caltrans road classification data.

There are about 780K road segments in the dataset. We don't need all
of them — just the totals per county broken out by road type. So we
use CKAN's server-side SQL to do the GROUP BY remotely and only get
back ~350 rows. Way better than downloading 780K records.

Road types use the FHWA system: 1=Interstate, 2=Freeway/Expressway,
3=Principal Arterial, 4=Minor Arterial, 5=Major Collector,
6=Minor Collector, 7=Local.

The segment lengths are in meters (Web Mercator projection) so we
convert to miles. There's some distortion from the projection —
maybe 2-5% at California's latitude — but for comparing counties
it doesn't matter.

Source: https://data.ca.gov/dataset/public-road-functional-classification

Usage:
    python -m etl.load_road_miles
"""

import logging

from sqlalchemy import select

from app.database import SessionLocal
from app.models import County, RoadMile
from etl._utils import get_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

RESOURCE_ID = "5180390d-e323-4751-8ce9-939e62918233"

# Instead of downloading all 780K road segments and grouping them ourselves,
# we use CKAN's SQL endpoint to do the GROUP BY on their server. That way
# we only get back ~350 rows (one per county per road type). Way faster.
CKAN_SQL_URL = "https://data.ca.gov/api/3/action/datastore_search_sql"

# The road segment lengths in the dataset are in meters because they use
# Web Mercator projection (EPSG:3857). We divide by this to get miles.
# There's some distortion from the projection — maybe 2-5% at California's
# latitude — but for comparing counties it's fine.
METERS_PER_MILE = 1609.344

AGGREGATE_SQL = f"""
    SELECT "County_label", "F_System",
           COUNT(*) as segment_count,
           SUM(CAST("Shape_Length" AS FLOAT)) / {METERS_PER_MILE} as total_miles
    FROM "{RESOURCE_ID}"
    WHERE "County_label" IS NOT NULL
      AND "F_System" IS NOT NULL
    GROUP BY "County_label", "F_System"
    ORDER BY "County_label", "F_System"
"""


def fetch_aggregated() -> list[dict]:
    """Run the GROUP BY query on CKAN's server and get back ~350 rows.

    The SQL groups by county and road type (F_System), counts segments,
    and sums up the total length in miles. This turns 780K road segments
    into a manageable number of rows we can just loop through and insert.
    """
    resp = get_with_retry(
        CKAN_SQL_URL,
        params={"sql": AGGREGATE_SQL},
        timeout=120.0,
    )
    data = resp.json()
    records = data.get("result", {}).get("records", [])
    return records


@track_etl_run("road_miles")
def run():
    """Main ETL entry point."""
    db = SessionLocal()
    try:
        # Build county name -> code lookup
        counties = db.execute(select(County.code, County.name)).all()
        name_to_code = {c.name.upper(): c.code for c in counties}
        logger.info("Loaded %d counties", len(name_to_code))

        records = fetch_aggregated()
        logger.info("Fetched %d aggregated rows from CKAN SQL", len(records))

        inserted = 0
        updated = 0
        for rec in records:
            county_name = str(rec.get("County_label", "")).strip().upper()
            county_code = name_to_code.get(county_name)
            if county_code is None:
                continue

            try:
                f_system = int(rec["F_System"])
                segment_count = int(rec["segment_count"])
                total_miles = round(float(rec["total_miles"]), 2)
            except (ValueError, TypeError, KeyError):
                continue

            existing = db.query(RoadMile).filter_by(
                county_code=county_code,
                f_system=f_system,
            ).first()

            if existing:
                existing.segment_count = segment_count
                existing.total_miles = total_miles
                updated += 1
            else:
                db.add(RoadMile(
                    county_code=county_code,
                    f_system=f_system,
                    segment_count=segment_count,
                    total_miles=total_miles,
                ))
                inserted += 1

        db.commit()
        logger.info("Done. %d inserted, %d updated", inserted, updated)
    finally:
        db.close()


if __name__ == "__main__":
    run()
