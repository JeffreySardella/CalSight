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


# How many hours before we consider a source "stale". Shared between the
# /api/freshness router (per-source detail) and the ETL pipeline's stale-source
# sweep so the two can never drift apart. Historically this lived only in
# app.routers.freshness, so is_stale existed solely on an endpoint no frontend
# reads — and every monthly source sat two months stale (2026-07-17) without a
# single alert. Moving it here lets the scheduler alert on the same numbers.
DEFAULT_STALENESS_THRESHOLD_HOURS = 168  # 1 week

STALENESS_THRESHOLDS: dict[str, int] = {
    "crashes_ccrs": 48,      # CHP updates daily; 48h buffer
    "parties": 48,
    "victims": 48,
    "backfill": 48,
    "backfill_conditions": 48,
    "matviews": 48,
    "demographics": 720,     # Census: monthly (30 days)
    "weather": 720,
    "hospitals": 720,
    "schools": 720,
    "speed_limits": 720,
    "aadt": 720,
    "vehicles": 720,
    "unemployment": 720,
    "calenviroscreen": 720,
    "licensed_drivers": 720,
    "road_miles": 720,
    "insights": 48,
    "vacuum": 72,
    "data_quality": 48,
    "validate_coords": 48,
    # Water module: all three run on the daily schedule (drought data only
    # changes weekly upstream, but the JOB runs daily, and freshness tracks
    # job success — so 48h catches a broken loader within two cycles).
    "reservoirs": 48,
    "snowpack": 48,
    "drought": 48,
}


def _hours_between(now: datetime, then: Optional[datetime]) -> Optional[float]:
    if then is None:
        return None
    return round((now - then).total_seconds() / 3600, 1)


def threshold_for(source: str) -> int:
    """Staleness threshold for a source, falling back to the 1-week default."""
    return STALENESS_THRESHOLDS.get(source, DEFAULT_STALENESS_THRESHOLD_HOURS)


def stale_sources(
    now: datetime,
    last_sync_by_source: dict[str, Optional[datetime]],
    sources: set[str],
) -> list[tuple[str, Optional[float], int]]:
    """Sources overdue for an upstream-sync confirmation.

    Args:
        now: current time (naive UTC, matching stored timestamps).
        last_sync_by_source: last confirmed-sync time per source (a successful
            load OR a verified-unchanged check), from the etl_runs table.
        sources: the set of source names to evaluate (the live registry jobs).

    Returns:
        (source, hours_since_sync, threshold_hours) for each stale source,
        most overdue first (never-synced sources — hours None — lead). A source
        is stale when it has no recorded sync, or its last sync is older than
        its threshold.
    """
    stale: list[tuple[str, Optional[float], int]] = []
    for source in sources:
        threshold = threshold_for(source)
        last_sync = last_sync_by_source.get(source)
        is_stale, _, hours_since_check = compute_staleness(
            now=now,
            last_load_at=last_sync,
            last_check_at=last_sync,
            threshold_hours=threshold,
        )
        if is_stale:
            stale.append((source, hours_since_check, threshold))

    # Most overdue first; never-synced (None) sorts ahead of everything.
    stale.sort(
        key=lambda item: item[1] if item[1] is not None else float("inf"),
        reverse=True,
    )
    return stale


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
