"""Backfill crashes.city_id from the existing free-text crashes.city_name.

The ETL loader (`etl/load_crashes.py`) normalizes city_id on new loads, but
the ~25M rows already in Azure carry city_name strings only. This script
walks the cities lookup once and updates crash rows in batches.

Strategy:
- Build the (county_code, name_normalized) -> city_id map in memory.
- For each (county_code, city) entry, run a single UPDATE that targets all
  crashes in that county whose normalized city_name matches. ~1600 UPDATEs
  total, indexed by ix_crashes_county_code — far fewer round trips than
  per-row updates.
- Idempotent: rerunning produces the same result.

Usage:
    python -m etl.backfill_city_id
    python -m etl.backfill_city_id --dry-run

NOT wired into run_all_etl.sh — Jeff should run this once after the
migration ships, during a quiet window. Subsequent crash reloads will set
city_id automatically.
"""

import argparse
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal
from app.models import City, EtlRun

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# Normalization done in Postgres so we don't have to pull every crash
# row across the wire. Mirrors app.cities_match.normalize_name() for the
# subset of transformations that are safe in SQL:
#   - trim
#   - lower
#   - strip ", ca" / ", california" / " ca" suffix
#   - strip "city of " / "town of " prefix
#   - strip "city" / "town" / "cdp" trailing word
#   - collapse non-word/space chars to spaces, then collapse whitespace
# `unaccent` would handle ASCII folding but isn't enabled in our DB by
# default, so San José rows will only match if reported without accent.
# That's acceptable for a backfill — the ETL path handles diacritics in Python.
_NORMALIZE_SQL = r"""
trim(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(city_name), ',\s*california\s*$', ''),
          ',?\s*ca\s*$', ''
        ),
        '^(city|town)\s+of\s+', ''
      ),
      '\s+(city|town|cdp)\s*$', ''
    ),
    '[^a-z0-9\s]', ' ', 'g'
  )
)
"""


def run(dry_run: bool = False) -> None:
    db = SessionLocal()
    etl_run = EtlRun(
        source="backfill_city_id",
        status="running",
        started_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(etl_run)
    db.commit()

    total_updated = 0
    try:
        cities = db.query(City.id, City.county_code, City.name_normalized).all()
        logger.info("Loaded %d cities for backfill", len(cities))

        # Group by (county_code, name_normalized) — the unique constraint
        # already guarantees no duplicates per county, so this is just a
        # safety pass for the dict shape.
        for city_id, county_code, name_normalized in cities:
            if not name_normalized:
                continue

            stmt = text(
                f"""
                UPDATE crashes
                SET city_id = :city_id
                WHERE county_code = :county_code
                  AND city_id IS DISTINCT FROM :city_id
                  AND regexp_replace({_NORMALIZE_SQL}, '\\s+', ' ', 'g') = :name_norm
                """
            )
            params = {
                "city_id": city_id,
                "county_code": county_code,
                "name_norm": name_normalized,
            }
            if dry_run:
                # COUNT instead of UPDATE
                count_stmt = text(
                    f"""
                    SELECT COUNT(*) FROM crashes
                    WHERE county_code = :county_code
                      AND city_id IS DISTINCT FROM :city_id
                      AND regexp_replace({_NORMALIZE_SQL}, '\\s+', ' ', 'g') = :name_norm
                    """
                )
                result = db.execute(count_stmt, params).scalar() or 0
            else:
                result = db.execute(stmt, params).rowcount or 0
                db.commit()

            if result > 0:
                logger.info(
                    "%s city_id=%d (county=%d, name=%r): %d rows",
                    "[dry-run] would update" if dry_run else "updated",
                    city_id, county_code, name_normalized, result,
                )
            total_updated += result

        logger.info("Done. %d rows %s.", total_updated, "would be updated" if dry_run else "updated")
        etl_run.status = "success" if not dry_run else "dry_run"
        etl_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        etl_run.rows_loaded = total_updated
        db.commit()
    except Exception as exc:
        logger.exception("Backfill failed: %s", exc)
        try:
            etl_run.status = "error"
            etl_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            etl_run.error_message = str(exc)
            db.commit()
        except Exception:
            db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill crashes.city_id from city_name")
    parser.add_argument("--dry-run", action="store_true", help="Count rows without writing")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
