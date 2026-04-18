"""Run VACUUM ANALYZE on the tables the dashboard queries hit hardest.

Why this exists:
  Postgres's query planner makes decisions based on table statistics it
  caches internally. After a big load (millions of new crash rows, etc.)
  those stats get stale — the planner might pick a seq scan where an
  index scan would be faster, or vice versa. VACUUM ANALYZE refreshes
  the stats and reclaims dead rows from updates.

  VACUUM ANALYZE is light (no exclusive lock) and safe to run while the
  app is serving traffic. Runs at the tail of run_all_etl.sh after all
  the heavy loads are done.

Usage:
    python -m etl.vacuum_analyze
"""

from __future__ import annotations

import logging

from app.database import engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Tables worth vacuuming after a bulk load. Small lookup tables
# (counties, 58 rows) don't need it. Materialized views are included —
# they're physically stored the same way as regular tables and benefit
# from the same planner statistics.
_TABLES = [
    "crashes",
    "crash_parties",
    "crash_victims",
    "demographics",
    "weather",
    "unemployment_rates",
    "vehicle_registrations",
    "licensed_drivers",
    "road_miles",
    "data_quality_stats",
    "county_insights",
    "county_insight_details",
    # Materialized views — VACUUM ANALYZE updates planner stats so the
    # API picks the right index when querying them.
    "mv_crashes_by_hour",
    "mv_crashes_by_cause",
    "mv_crashes_by_year",
]


def run() -> None:
    """Run VACUUM ANALYZE on each target table.

    VACUUM cannot run inside a transaction, so we open an autocommit
    connection and issue each command separately. Tables that don't
    exist yet (e.g., on a fresh DB) are skipped with a warning rather
    than aborting the run.
    """
    # AUTOCOMMIT is required — VACUUM errors out inside a transaction
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for table in _TABLES:
            try:
                from sqlalchemy import text  # noqa: PLC0415
                logger.info("VACUUM ANALYZE %s", table)
                conn.execute(text(f"VACUUM ANALYZE {table}"))
            except Exception as exc:
                # Most common cause is the table not existing yet.
                logger.warning("Skipping %s: %s", table, exc)

    logger.info("VACUUM ANALYZE complete for %d tables", len(_TABLES))


if __name__ == "__main__":
    run()
