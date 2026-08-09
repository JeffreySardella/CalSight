"""Refresh the StatsPage materialized views.

Views and the migrations that defined them:
  - mv_crashes_by_hour                     (f3d4e5f6a7b8)
  - mv_crashes_by_cause                    (f3d4e5f6a7b8)
  - mv_crashes_by_year                     (f3d4e5f6a7b8)
  - mv_crash_victims_by_demographics       (b5e9d3f1c8a4) — gender / age
  - mv_at_fault_parties_by_demographics    (f8a1b2c3d4e5) — at-fault party gender / age
  - mv_crashes_by_month                    (g4h5i6j7k8l9) — seasonality
  - mv_crash_rates                         (g4h5i6j7k8l9) — per-capita rates
  - mv_street_aggregates                   (c4f1a9b2d3e7) — street-level rollup

mv_street_aggregates is "optional": the street endpoints fall back to the
raw crashes table when it is unpopulated, so unlike the others it does not
gate the site-wide rebuilding banner. See app/health.py.

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

from app.database import etl_engine as engine  # write/DDL role
from app.health import REFRESHABLE_VIEWS
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_VIEWS = list(REFRESHABLE_VIEWS)


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
    #
    # Refresh every view independently and only raise at the end. Failing fast
    # on the first error used to leave every LATER view stale while the earlier
    # ones were fresh — a bigger, silent cross-view inconsistency than a single
    # failed view. Isolating failures shrinks the inconsistency to just the
    # view that errored, and the aggregated raise still fails the "matviews"
    # etl_run so the freshness API surfaces the problem.
    failures: list[str] = []
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
                failures.append(view)

    if failures:
        raise RuntimeError(
            f"{len(failures)} materialized view(s) failed to refresh: "
            + ", ".join(failures)
        )

    logger.info("All materialized views refreshed")


if __name__ == "__main__":
    # Wrap with etl_run tracking when called from the command line
    track_etl_run("matviews")(run)()
