"""Mark stale 'running' etl_runs rows as errored.

When an ETL job is hard-killed (e.g. OOM / exit 137) it never writes its
terminal status, so its `etl_runs` row is stuck at status='running' forever.
Those zombie rows make /api/freshness and the pipeline-health view look like a
job is perpetually in flight. This resets any 'running' row older than a safety
threshold (default 6h — longer than any real job, which the workflow caps at
4h) to 'error', leaving genuinely in-flight jobs untouched.

Usage:
    python -m etl.clear_stale_runs            # rows running > 6h
    python -m etl.clear_stale_runs 12         # rows running > 12h
"""

from __future__ import annotations

import logging
import sys

from sqlalchemy import text

from app.database import etl_engine  # write role

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_SQL = text(
    """
    UPDATE etl_runs
       SET status = 'error',
           finished_at = COALESCE(finished_at, now()),
           error_message = COALESCE(
               error_message,
               'cleared: stale running row (process died without terminal status)'
           )
     WHERE status = 'running'
       AND started_at < now() - (:h * interval '1 hour')
    """
)


def clear_stale_runs(older_than_hours: float = 6.0, *, conn=None) -> int:
    """Reset 'running' rows older than the threshold to 'error'.

    Returns the number of rows updated. `conn` (a Connection or Session) is
    injectable for testing and runs inside the caller's transaction; when
    omitted, a fresh transaction on the ETL write-role engine is used.
    """
    if conn is not None:
        return conn.execute(_SQL, {"h": older_than_hours}).rowcount
    with etl_engine.begin() as c:
        return c.execute(_SQL, {"h": older_than_hours}).rowcount


if __name__ == "__main__":
    hours = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0
    n = clear_stale_runs(hours)
    logger.info("Cleared %d stale 'running' etl_runs row(s) older than %sh.", n, hours)
    print(f"Cleared {n} stale running row(s).")
