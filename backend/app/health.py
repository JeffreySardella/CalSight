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
# These gate the site-wide "rebuilding" banner: if one is unpopulated, the
# pages that depend on it have no data to show.
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

# Views that are refreshed nightly but must NOT gate the rebuilding banner,
# because the API degrades gracefully without them rather than going blank.
# etl/refresh_materialized_views.py refreshes MATERIALIZED_VIEWS + these.
#
# mv_street_aggregates is an optimization: /api/intersections and
# /api/corridors fall back to querying the raw crashes table when it isn't
# populated. Slow is not the same as broken, so an unpopulated street view
# shouldn't put a banner across the whole site.
OPTIONAL_MATERIALIZED_VIEWS: tuple[str, ...] = ("mv_street_aggregates",)

# Everything the nightly refresh job maintains.
REFRESHABLE_VIEWS: tuple[str, ...] = MATERIALIZED_VIEWS + OPTIONAL_MATERIALIZED_VIEWS


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
            text("SELECT bool_and(relispopulated) FROM pg_class WHERE relname = ANY(:names) AND relkind = 'm'"),
            {"names": names},
        ).scalar()
    except Exception:
        return False
    return populated is False
