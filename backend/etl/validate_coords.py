"""Validate crash lat/lng against county boundary polygons.

For each crash that has coordinates, checks whether the point actually
falls inside the polygon of the county it's assigned to (county_code).
Sets coord_county_mismatch = True for mismatches, False for valid points.

Uses shapely for point-in-polygon checks and the same ca-counties.geojson
that the frontend renders on the map. A configurable buffer (default 500m)
forgives GPS drift near county borders.

Usage:
    python -m etl.validate_coords
    python -m etl.validate_coords --county 19        # Just LA County
    python -m etl.validate_coords --audit-only       # Print stats, don't update
    python -m etl.validate_coords --buffer 0         # Strict, no tolerance
    python -m etl.validate_coords --buffer 1000      # 1km tolerance
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime

from shapely.geometry import Point, shape
from shapely.prepared import prep
from sqlalchemy import text, update

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import Crash
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

BATCH_SIZE = 10_000
GEOJSON_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "ca-counties-tiger.geojson"
)
GEOJSON_FALLBACK = os.path.join(
    os.path.dirname(__file__), "..", "..", "frontend", "public", "ca-counties.geojson"
)

# With TIGER/Line boundaries (survey-grade precision), no buffer needed.
# The boundary IS the ground truth.
DEFAULT_BUFFER_METERS = 0
_DEGREES_PER_METER = 1 / 111_000  # approximate at CA latitudes


def load_county_polygons(geojson_path: str, buffer_m: float = DEFAULT_BUFFER_METERS) -> dict[int, object]:
    """Load county boundary polygons from GeoJSON, keyed by county_code.

    Applies a buffer (in meters, converted to approximate degrees) so that
    points near county borders aren't flagged as mismatches due to GPS drift.

    Returns prepared geometries for fast point-in-polygon lookups.
    """
    with open(geojson_path) as f:
        data = json.load(f)

    buffer_deg = buffer_m * _DEGREES_PER_METER

    polygons = {}
    for feature in data["features"]:
        code = feature["properties"]["county_code"]
        geom = shape(feature["geometry"])
        if buffer_deg > 0:
            geom = geom.buffer(buffer_deg)
        polygons[code] = prep(geom)

    logger.info(
        "Loaded %d county polygons (buffer=%dm / ~%.4f°)",
        len(polygons), int(buffer_m), buffer_deg,
    )
    return polygons


def validate_batch(rows, polygons) -> tuple[list[int], list[int]]:
    """Check a batch of (id, lat, lng, county_code) rows.

    Returns (mismatch_ids, valid_ids).
    """
    mismatches = []
    valid = []

    for row in rows:
        crash_id, lat, lng, county_code = row
        poly = polygons.get(county_code)
        if poly is None:
            mismatches.append(crash_id)
            continue

        point = Point(lng, lat)
        if poly.contains(point):
            valid.append(crash_id)
        else:
            mismatches.append(crash_id)

    return mismatches, valid


def run(county_code: int | None = None, audit_only: bool = False, buffer_m: float = DEFAULT_BUFFER_METERS) -> int:
    """Main validation logic.

    Returns total number of mismatched crashes found.
    """
    geojson_path = os.path.normpath(GEOJSON_PATH)
    if not os.path.exists(geojson_path):
        geojson_path = os.path.normpath(GEOJSON_FALLBACK)
        if not os.path.exists(geojson_path):
            logger.error("GeoJSON not found at %s or %s", GEOJSON_PATH, GEOJSON_FALLBACK)
            sys.exit(1)
        logger.info("Using frontend GeoJSON fallback: %s", geojson_path)

    polygons = load_county_polygons(geojson_path, buffer_m=buffer_m)

    db = SessionLocal()
    try:
        where_clause = "WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
        params = {}
        if county_code is not None:
            where_clause += " AND county_code = :county_code"
            params["county_code"] = county_code

        total_q = db.execute(
            text(f"SELECT COUNT(*) FROM crashes {where_clause}"), params
        ).scalar()
        logger.info("Crashes with coordinates to validate: %s", f"{total_q:,}")

        total_mismatches = 0
        total_valid = 0
        offset = 0

        while True:
            rows = db.execute(
                text(
                    f"SELECT id, latitude, longitude, county_code "
                    f"FROM crashes {where_clause} "
                    f"ORDER BY id LIMIT :limit OFFSET :offset"
                ),
                {**params, "limit": BATCH_SIZE, "offset": offset},
            ).fetchall()

            if not rows:
                break

            mismatches, valid = validate_batch(rows, polygons)
            total_mismatches += len(mismatches)
            total_valid += len(valid)

            if not audit_only and (mismatches or valid):
                now = datetime.utcnow()
                if mismatches:
                    db.execute(
                        update(Crash)
                        .where(Crash.id.in_(mismatches))
                        .values(coord_county_mismatch=True, coord_validated_at=now)
                    )
                if valid:
                    db.execute(
                        update(Crash)
                        .where(Crash.id.in_(valid))
                        .values(coord_county_mismatch=False, coord_validated_at=now)
                    )
                db.commit()

            offset += BATCH_SIZE
            processed = offset if offset < total_q else total_q
            if offset % (BATCH_SIZE * 10) == 0 or not rows:
                logger.info(
                    "Progress: %s / %s (%.1f%%) — %s mismatches so far",
                    f"{processed:,}",
                    f"{total_q:,}",
                    processed / total_q * 100 if total_q else 0,
                    f"{total_mismatches:,}",
                )

        mismatch_pct = (
            round(total_mismatches / (total_mismatches + total_valid) * 100, 2)
            if (total_mismatches + total_valid) > 0
            else 0
        )
        logger.info("=" * 60)
        logger.info("RESULTS:")
        logger.info("  Total checked:    %s", f"{total_mismatches + total_valid:,}")
        logger.info("  Valid:            %s", f"{total_valid:,}")
        logger.info("  Mismatched:       %s (%.2f%%)", f"{total_mismatches:,}", mismatch_pct)
        if audit_only:
            logger.info("  (audit-only mode — no rows updated)")
        else:
            logger.info("  Updated coord_county_mismatch column in DB")
        logger.info("=" * 60)

        return total_mismatches

    finally:
        db.close()


@track_etl_run("validate_coords")
def run_tracked(county_code: int | None = None, audit_only: bool = False, buffer_m: float = DEFAULT_BUFFER_METERS) -> int:
    return run(county_code=county_code, audit_only=audit_only, buffer_m=buffer_m)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate crash coordinates against county boundaries")
    parser.add_argument("--county", type=int, help="Only validate a specific county_code (1-58)")
    parser.add_argument("--audit-only", action="store_true", help="Print stats without updating the DB")
    parser.add_argument("--buffer", type=float, default=DEFAULT_BUFFER_METERS, help="Tolerance in meters (default 500). Set to 0 for strict matching.")
    args = parser.parse_args()

    run_tracked(county_code=args.county, audit_only=args.audit_only, buffer_m=args.buffer)
