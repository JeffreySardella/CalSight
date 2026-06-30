"""Pure staleness-decision logic for the freshness API (no DB imports).

A data source is "stale" when the pipeline hasn't *confirmed it is in sync*
with upstream within the source's threshold — i.e. it hasn't either loaded
new rows or verified that upstream is unchanged. This is distinct from "the
data last changed a long time ago": static annual sources (census, hospitals)
load rarely but the orchestrator checks them every run and records a
`skipped_unchanged` row, so they stay fresh as long as the pipeline runs.

Keeping this logic free of database/app imports makes it unit-testable
without a live Postgres.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional


def _hours_between(now: datetime, then: Optional[datetime]) -> Optional[float]:
    if then is None:
        return None
    return round((now - then).total_seconds() / 3600, 1)


def compute_staleness(
    now: datetime,
    last_load_at: Optional[datetime],
    last_check_at: Optional[datetime],
    threshold_hours: int,
) -> tuple[bool, Optional[float], Optional[float]]:
    """Decide staleness from the last load and the last upstream-sync check.

    Args:
        now: current time (naive UTC, matching stored timestamps).
        last_load_at: most recent successful row-load, or None.
        last_check_at: most recent time we confirmed sync with upstream
            (loaded new rows OR verified unchanged), or None.
        threshold_hours: how long without a confirmed sync before stale.

    Returns:
        (is_stale, hours_since_load, hours_since_check).
    """
    hours_since_load = _hours_between(now, last_load_at)
    hours_since_check = _hours_between(now, last_check_at)

    if hours_since_check is None:
        is_stale = True
    else:
        is_stale = hours_since_check > threshold_hours

    return is_stale, hours_since_load, hours_since_check
