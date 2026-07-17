"""Data freshness API — per-source staleness detail.

Endpoints (both deprecated, #291):
  GET /api/freshness          — per-source last-updated timestamps + row counts
  GET /api/freshness/summary  — single object with overall freshness status

The frontend never adopted these — it reads GET /api/meta/data-freshness
(app.routers.meta) for the "data as of" pill. Both routes keep working for
external consumers, and the shared "latest success per source" query now
lives in app.routers.meta.latest_successful_runs so there is a single
implementation. The extra value here (staleness thresholds, fresh/stale
rollup) remains available but is flagged deprecated in OpenAPI.

All data comes from the etl_runs table — no extra bookkeeping needed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import desc, func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.freshness_logic import (
    DEFAULT_STALENESS_THRESHOLD_HOURS,
    STALENESS_THRESHOLDS,
    compute_staleness,
)
from app.models import EtlRun
from app.routers.meta import latest_successful_runs

router = APIRouter(tags=["freshness"])

# Statuses that count as "we confirmed sync with upstream": either we loaded
# new rows (success) or we verified upstream is unchanged (skipped_unchanged).
_SYNC_STATUSES = ("success", "skipped_unchanged")

_limiter = Limiter(key_func=rate_limit_key)


class SourceFreshness(BaseModel):
    source: str
    last_success_at: Optional[datetime]      # last time rows actually loaded
    last_checked_at: Optional[datetime]      # last time we confirmed sync w/ upstream
    rows_loaded: Optional[int]
    hours_since_update: Optional[float]      # since last_success_at (data age)
    hours_since_check: Optional[float]       # since last_checked_at (drives is_stale)
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


# Staleness thresholds moved to app.freshness_logic so the ETL pipeline's
# stale-source alert sweep and this API read the same numbers (2026-07-17).
_STALENESS_THRESHOLDS = STALENESS_THRESHOLDS


# deprecated (#291): no frontend callers — the UI reads /api/meta/data-freshness.
@router.get("/freshness", response_model=list[SourceFreshness], deprecated=True)
@_limiter.limit("1000/minute;20000/hour")
def get_freshness(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Per-source freshness information.

    Returns the last successful run timestamp and row count for each
    ETL source, with staleness computed against per-source thresholds.
    Deprecated: prefer /api/meta/data-freshness (this route delegates to
    the same underlying query).
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    # Most recent successful run per source — shared with /api/meta/data-freshness.
    rows = latest_successful_runs(db)

    # Last time we confirmed sync with upstream per source — a successful load
    # OR a skipped_unchanged check both count. This is what staleness keys off,
    # so static annual sources (checked daily, loaded rarely) don't read stale.
    last_check_by_source = dict(
        db.query(EtlRun.source, func.max(EtlRun.finished_at))
        .filter(EtlRun.status.in_(_SYNC_STATUSES))
        .group_by(EtlRun.source)
        .all()
    )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    results = []

    for run in rows:
        threshold = _STALENESS_THRESHOLDS.get(run.source, DEFAULT_STALENESS_THRESHOLD_HOURS)
        last_check = last_check_by_source.get(run.source, run.finished_at)
        is_stale, hours_since_load, hours_since_check = compute_staleness(
            now=now,
            last_load_at=run.finished_at,
            last_check_at=last_check,
            threshold_hours=threshold,
        )

        results.append(
            SourceFreshness(
                source=run.source,
                last_success_at=run.finished_at,
                last_checked_at=last_check,
                rows_loaded=run.rows_loaded,
                hours_since_update=hours_since_load,
                hours_since_check=hours_since_check,
                is_stale=is_stale,
                staleness_threshold_hours=threshold,
            ).model_dump()
        )

    # Sort: stale sources first, then by recency of last upstream check
    results.sort(key=lambda x: (not x["is_stale"], x["hours_since_check"] or 9999))

    return results


# deprecated (#291): no frontend callers — the UI reads /api/meta/data-freshness.
@router.get("/freshness/summary", response_model=FreshnessSummary, deprecated=True)
@_limiter.limit("1000/minute;20000/hour")
def get_freshness_summary(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Single-object summary of data freshness.

    Deprecated: no frontend callers — kept for external monitors that may
    poll it.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    now = datetime.now(timezone.utc).replace(tzinfo=None)

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

    # Last confirmed-sync time per source (success OR skipped_unchanged).
    last_check_by_source = dict(
        db.query(EtlRun.source, func.max(EtlRun.finished_at))
        .filter(EtlRun.status.in_(_SYNC_STATUSES))
        .group_by(EtlRun.source)
        .all()
    )

    for source, last_at in runs:
        loaded_sources.add(source)
        if source not in _STALENESS_THRESHOLDS:
            continue
        threshold = _STALENESS_THRESHOLDS[source]
        last_check = last_check_by_source.get(source, last_at)
        is_stale, _, _ = compute_staleness(
            now=now,
            last_load_at=last_at,
            last_check_at=last_check,
            threshold_hours=threshold,
        )
        if is_stale:
            sources_stale += 1
        else:
            sources_fresh += 1

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
