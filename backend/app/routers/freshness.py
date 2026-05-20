"""Data freshness API — tells the frontend how stale each data source is.

Endpoints:
  GET /api/freshness          — per-source last-updated timestamps + row counts
  GET /api/freshness/summary  — single object with overall freshness status

The frontend uses this to:
  1. Show "Data last updated: 2 hours ago" in the footer
  2. Display a warning banner if crash data is stale (>48h old)
  3. Show per-source status in an admin/data-health page

All data comes from the etl_runs table — no extra bookkeeping needed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import desc, func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EtlRun

router = APIRouter(tags=["freshness"])

_limiter = Limiter(key_func=get_remote_address)


class SourceFreshness(BaseModel):
    source: str
    last_success_at: Optional[datetime]
    rows_loaded: Optional[int]
    hours_since_update: Optional[float]
    is_stale: bool
    staleness_threshold_hours: int


class FreshnessSummary(BaseModel):
    overall_status: str  # "fresh", "stale", "unknown"
    crash_data_age_hours: Optional[float]
    last_successful_pipeline: Optional[datetime]
    total_crash_rows: Optional[int]
    sources_fresh: int
    sources_stale: int
    sources_never_loaded: int


# How many hours before we consider a source "stale"
_STALENESS_THRESHOLDS = {
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
}


@router.get("/freshness")
@_limiter.limit("1000/minute;20000/hour")
def get_freshness(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Per-source freshness information.

    Returns the last successful run timestamp and row count for each
    ETL source. The frontend can use hours_since_update to show relative
    freshness ("2 hours ago") and is_stale to trigger warning banners.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    # Get the most recent successful run per source
    subq = (
        db.query(
            EtlRun.source,
            func.max(EtlRun.finished_at).label("last_success"),
        )
        .filter(EtlRun.status == "success")
        .group_by(EtlRun.source)
        .subquery()
    )

    rows = (
        db.query(EtlRun)
        .join(subq, (EtlRun.source == subq.c.source) & (EtlRun.finished_at == subq.c.last_success))
        .all()
    )

    now = datetime.utcnow()
    results = []

    for run in rows:
        threshold = _STALENESS_THRESHOLDS.get(run.source, 168)  # default 1 week
        hours_ago = None
        is_stale = False

        if run.finished_at:
            hours_ago = (now - run.finished_at).total_seconds() / 3600
            is_stale = hours_ago > threshold

        results.append(
            SourceFreshness(
                source=run.source,
                last_success_at=run.finished_at,
                rows_loaded=run.rows_loaded,
                hours_since_update=round(hours_ago, 1) if hours_ago is not None else None,
                is_stale=is_stale,
                staleness_threshold_hours=threshold,
            ).model_dump()
        )

    # Sort: stale sources first, then by recency
    results.sort(key=lambda x: (not x["is_stale"], x["hours_since_update"] or 9999))

    return results


@router.get("/freshness/summary")
@_limiter.limit("1000/minute;20000/hour")
def get_freshness_summary(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Single-object summary of data freshness for the dashboard footer.

    The frontend calls this once on page load to decide whether to show
    a "data may be stale" banner and to populate the footer timestamp.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    now = datetime.utcnow()

    # Last successful crash data load
    crash_run = (
        db.query(EtlRun)
        .filter(EtlRun.source == "crashes_ccrs", EtlRun.status == "success")
        .order_by(desc(EtlRun.finished_at))
        .first()
    )

    # Last successful pipeline completion (any source)
    last_pipeline = (
        db.query(func.max(EtlRun.finished_at))
        .filter(EtlRun.status == "success")
        .scalar()
    )

    # Total crash rows — use pg_class estimate to avoid full table scan
    total_crashes = db.execute(text(
        "SELECT reltuples::bigint FROM pg_class WHERE relname = 'crashes'"
    )).scalar() or 0

    # Count fresh vs stale sources
    sources_fresh = 0
    sources_stale = 0
    sources_never = 0

    all_sources = set(_STALENESS_THRESHOLDS.keys())
    loaded_sources = set()

    runs = (
        db.query(EtlRun.source, func.max(EtlRun.finished_at).label("last"))
        .filter(EtlRun.status == "success")
        .group_by(EtlRun.source)
        .all()
    )

    for source, last_at in runs:
        loaded_sources.add(source)
        if source not in _STALENESS_THRESHOLDS:
            continue
        threshold = _STALENESS_THRESHOLDS[source]
        if last_at and (now - last_at).total_seconds() / 3600 <= threshold:
            sources_fresh += 1
        else:
            sources_stale += 1

    sources_never = len(all_sources - loaded_sources)

    crash_age = None
    if crash_run and crash_run.finished_at:
        crash_age = round((now - crash_run.finished_at).total_seconds() / 3600, 1)

    # Overall status
    if crash_age is None:
        status = "unknown"
    elif crash_age <= 48:
        status = "fresh"
    else:
        status = "stale"

    return FreshnessSummary(
        overall_status=status,
        crash_data_age_hours=crash_age,
        last_successful_pipeline=last_pipeline,
        total_crash_rows=total_crashes,
        sources_fresh=sources_fresh,
        sources_stale=sources_stale,
        sources_never_loaded=sources_never,
    ).model_dump()
