"""FHWA HPMS speed limit ETL.

Fetches posted speed limit data from the Federal Highway Administration's
Highway Performance Monitoring System (HPMS) for California, aggregates
by county and speed limit, and upserts into the speed_limits table.

This enables analysis like:
- Crash severity vs posted speed limit
- County speed limit profiles (urban vs rural)
- High-speed corridor crash rates

Source: FHWA HPMS 2022 via geo.dot.gov ArcGIS FeatureServer
~120K road segments with posted speed limits

Usage:
    python -m etl.load_speed_limits
"""

import logging
from collections import defaultdict

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import SessionLocal
from app.models import County, SpeedLimit
from etl._utils import get_with_retry, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

HPMS_URL = (
    "https://geo.dot.gov/server/rest/services/Hosted"
    "/HPMS_Full_CA_2022/FeatureServer/0/query"
)
PAGE_SIZE = 5000


def _safe_int(value):
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


@track_etl_run("speed_limits")
def run():
    """Main entry point."""
    db = SessionLocal()

    try:
        # HPMS uses numeric county IDs (1-58), same as our county_code
        # Verify we have counties loaded
        county_codes = {c[0] for c in db.query(County.code).all()}
        logger.info("Loaded %d county codes", len(county_codes))

        # Fetch all segments with speed limits, aggregate in memory
        # Key: (county_code, speed_limit) -> {count, total_lanes, total_aadt}
        agg: dict[tuple, dict] = defaultdict(
            lambda: {"segment_count": 0, "total_lanes": 0, "lane_count": 0, "total_aadt": 0}
        )

        offset = 0
        total_fetched = 0

        while True:
            params = {
                "where": "speed_limit IS NOT NULL AND speed_limit > 0",
                "outFields": "speed_limit,county_id,through_lanes,aadt",
                "resultRecordCount": PAGE_SIZE,
                "resultOffset": offset,
                "f": "json",
                "returnGeometry": "false",
            }

            resp = get_with_retry(HPMS_URL, params=params, timeout=60)
            data = resp.json()

            features = data.get("features", [])
            if not features:
                break

            for f in features:
                a = f["attributes"]
                county_id = _safe_int(a.get("county_id"))
                speed = _safe_int(a.get("speed_limit"))

                if county_id is None or speed is None:
                    continue
                if county_id not in county_codes:
                    continue

                key = (county_id, speed)
                agg[key]["segment_count"] += 1

                lanes = _safe_int(a.get("through_lanes"))
                if lanes is not None:
                    agg[key]["total_lanes"] += lanes
                    agg[key]["lane_count"] += 1

                aadt = _safe_int(a.get("aadt"))
                if aadt is not None:
                    agg[key]["total_aadt"] += aadt

            offset += len(features)
            total_fetched += len(features)
            logger.info("Fetched %d segments so far...", total_fetched)

            if not data.get("exceededTransferLimit", False):
                break

        logger.info("Total segments with speed limits: %d", total_fetched)
        logger.info("Unique (county, speed) combos: %d", len(agg))

        # Build rows
        rows = []
        for (county_code, speed_limit), data in agg.items():
            avg_lanes = None
            if data["lane_count"] > 0:
                avg_lanes = round(data["total_lanes"] / data["lane_count"], 1)

            rows.append({
                "county_code": county_code,
                "speed_limit": speed_limit,
                "segment_count": data["segment_count"],
                "avg_lanes": avg_lanes,
                "total_aadt": data["total_aadt"] or None,
            })

        # Bulk upsert
        if rows:
            batch_size = 500
            for i in range(0, len(rows), batch_size):
                batch = rows[i : i + batch_size]
                stmt = pg_insert(SpeedLimit).values(batch)
                stmt = stmt.on_conflict_do_update(
                    constraint="speed_limits_county_code_speed_limit_key",
                    set_={
                        "segment_count": stmt.excluded.segment_count,
                        "avg_lanes": stmt.excluded.avg_lanes,
                        "total_aadt": stmt.excluded.total_aadt,
                    },
                )
                db.execute(stmt)
                db.commit()

        logger.info("Done. %d speed limit records upserted.", len(rows))

    finally:
        db.close()


if __name__ == "__main__":
    run()
