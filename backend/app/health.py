"""Detection of a materialized-view rebuild window for /api/health.

A matview created/recreated WITH NO DATA has pg_class.relispopulated=false
until it is first populated. Normal nightly refreshes use REFRESH ...
CONCURRENTLY, which keeps the view populated throughout — so this only
fires during the non-concurrent initial population after a recreate
(the deploy scenario), not during routine refreshes.
"""

from __future__ import annotations

from typing import Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session

# Single source of truth for the MV names the API serves from.
# etl/refresh_materialized_views.py imports this list.
MATERIALIZED_VIEWS: tuple[str, ...] = (
    "mv_crashes_by_year",
    "mv_crashes_by_cause",
    "mv_crashes_by_hour",
    "mv_crashes_by_month",
    "mv_crash_victims_by_demographics",
    "mv_at_fault_parties_by_demographics",
    "mv_crash_rates",
    "mv_crashes_wide",
)


def is_rebuilding(db: Session, views: Iterable[str] | None = None) -> bool:
    """True iff at least one named matview exists and is unpopulated.

    bool_and over zero matching rows is NULL → treated as not rebuilding.
    Any error is swallowed → not rebuilding, so health never breaks itself.
    """
    names = list(views if views is not None else MATERIALIZED_VIEWS)
    if not names:
        return False
    try:
        populated = db.execute(
            text("SELECT bool_and(relispopulated) FROM pg_class WHERE relname = ANY(:names)"),
            {"names": names},
        ).scalar()
    except Exception:
        return False
    return populated is False
