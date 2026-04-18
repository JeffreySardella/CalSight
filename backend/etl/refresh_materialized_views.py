"""Refresh the three StatsPage materialized views.

The views are defined in migration f3d4e5f6a7b8:
  - mv_crashes_by_hour
  - mv_crashes_by_cause
  - mv_crashes_by_year

They were created WITH NO DATA — the first run of this module populates
them. Subsequent runs do a CONCURRENTLY refresh (doesn't block reads)
so API endpoints stay responsive during ETL.

Wired into run_all_etl.sh after compute_data_quality and before
vacuum_analyze — data_quality feeds the views, vacuum cleans up after.

Usage:
    python -m etl.refresh_materialized_views
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from app.database import engine
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_VIEWS = [
    "mv_crashes_by_year",    # smallest first, quick sanity check
    "mv_crashes_by_cause",
    "mv_crashes_by_hour",    # largest
]


def _has_data(conn, view: str) -> bool:
    """Whether the matview has been populated at least once.

    We can't SELECT from a WITH NO DATA matview — Postgres raises
    "materialized view has not been populated". So we check
    pg_class.relispopulated, which is false for WITH NO DATA views
    and true once they've been refreshed.
    """
    return bool(conn.execute(
        text("SELECT relispopulated FROM pg_class WHERE relname = :v"),
        {"v": view},
    ).scalar())


def run() -> None:
    """Refresh all materialized views.

    Uses CONCURRENTLY if the view already has data so API reads don't
    block during the refresh. First-time population uses a regular
    REFRESH because CONCURRENTLY requires the view to be non-empty.
    """
    # AUTOCOMMIT — REFRESH MATERIALIZED VIEW CONCURRENTLY needs its
    # own transaction, same as VACUUM.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for view in _VIEWS:
            populated = _has_data(conn, view)
            mode = "CONCURRENTLY" if populated else "(initial population)"
            logger.info("REFRESH MATERIALIZED VIEW %s %s", view, mode)
            try:
                if populated:
                    conn.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}"))
                else:
                    conn.execute(text(f"REFRESH MATERIALIZED VIEW {view}"))
                row_count = conn.execute(text(f"SELECT COUNT(*) FROM {view}")).scalar()
                logger.info("  %s refreshed: %s rows", view, f"{row_count:,}")
            except Exception as exc:
                logger.error("  %s failed: %s", view, exc)
                raise

    logger.info("All materialized views refreshed")


if __name__ == "__main__":
    # Wrap with etl_run tracking when called from the command line
    track_etl_run("materialized_views")(run)()
