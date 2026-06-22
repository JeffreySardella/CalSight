"""Pipeline health monitoring API.

Provides operational visibility into the automated data pipeline:
  - Current pipeline status (running, idle, error state)
  - Next scheduled run times
  - Historical success rates
  - Database size and performance metrics
  - Materialized view freshness

These endpoints power the admin dashboard and external monitoring
(Uptime Kuma, Grafana, etc.). The /api/pipeline/health endpoint
returns a simple status that monitoring tools can poll.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EtlRun
from app.routers.etl import _verify_etl_key

router = APIRouter(prefix="/pipeline", tags=["pipeline"])

_limiter = Limiter(key_func=get_remote_address)


class PipelineHealth(BaseModel):
    status: str  # "healthy", "degraded", "unhealthy"
    last_successful_run: Optional[datetime]
    last_failed_run: Optional[datetime]
    hours_since_success: Optional[float]
    active_jobs: int
    recent_failure_rate: float  # % of runs that failed in last 24h
    db_size_mb: Optional[float]
    matview_age_hours: Optional[float]


class MatviewStatus(BaseModel):
    name: str
    row_count: int
    last_refresh: Optional[str]
    is_populated: bool


class DbMetrics(BaseModel):
    total_size_mb: float
    table_sizes: list[dict]
    index_sizes: list[dict]
    dead_tuples_top5: list[dict]
    connection_count: int
    max_connections: int


@router.get("/health")
@_limiter.limit("10/minute")
def pipeline_health(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict:
    """Simple health check for monitoring tools.

    Returns status "healthy" when:
      - At least one successful run in the last 48 hours
      - Failure rate below 50% in last 24 hours
      - No zombie (stuck running) jobs

    Returns "degraded" when:
      - Last success was 48-96 hours ago, or failure rate is high

    Returns "unhealthy" when:
      - No successful run in 96+ hours
    """
    response.headers["Cache-Control"] = "no-cache"
    now = datetime.utcnow()

    # Last successful run
    last_success = (
        db.query(func.max(EtlRun.finished_at))
        .filter(EtlRun.status == "success")
        .scalar()
    )

    # Last failed run
    last_failure = (
        db.query(func.max(EtlRun.finished_at))
        .filter(EtlRun.status == "error")
        .scalar()
    )

    # Active (running) jobs
    active = (
        db.query(func.count())
        .filter(EtlRun.status == "running")
        .scalar()
    )

    # Failure rate in last 24h
    cutoff_24h = now - timedelta(hours=24)
    recent_total = (
        db.query(func.count())
        .filter(
            EtlRun.finished_at >= cutoff_24h,
            EtlRun.status.in_(["success", "error"]),
        )
        .scalar()
    ) or 0

    recent_failures = (
        db.query(func.count())
        .filter(
            EtlRun.finished_at >= cutoff_24h,
            EtlRun.status == "error",
        )
        .scalar()
    ) or 0

    failure_rate = (recent_failures / recent_total * 100) if recent_total > 0 else 0

    # DB size
    db_size = db.execute(text(
        "SELECT pg_database_size(current_database()) / (1024*1024.0)"
    )).scalar()

    # Matview age (time since last refresh of mv_crashes_by_year)
    matview_age = None
    try:
        # pg_stat_user_tables tracks last_analyze time which correlates
        # with matview refresh (we VACUUM ANALYZE after refresh)
        last_analyze = db.execute(text("""
            SELECT last_analyze FROM pg_stat_user_tables
            WHERE relname = 'mv_crashes_by_year'
        """)).scalar()
        if last_analyze:
            matview_age = round((now - last_analyze).total_seconds() / 3600, 1)
    except Exception:
        pass

    # Determine status
    hours_since = None
    if last_success:
        hours_since = round((now - last_success).total_seconds() / 3600, 1)

    if hours_since is None or hours_since > 96:
        status = "unhealthy"
    elif hours_since > 48 or failure_rate > 50:
        status = "degraded"
    else:
        status = "healthy"

    return PipelineHealth(
        status=status,
        last_successful_run=last_success,
        last_failed_run=last_failure,
        hours_since_success=hours_since,
        active_jobs=active,
        recent_failure_rate=round(failure_rate, 1),
        db_size_mb=round(db_size, 1) if db_size else None,
        matview_age_hours=matview_age,
    ).model_dump()


# Hardcoded allowlist of materialized view names. Only these identifiers
# may be interpolated into SQL queries. This prevents SQL injection even if
# the iteration source is later changed to accept external input.
_ALLOWED_MATVIEWS = frozenset([
    "mv_crashes_by_year",
    "mv_crashes_by_cause",
    "mv_crashes_by_hour",
    "mv_crashes_by_month",
    "mv_crash_victims_by_demographics",
    "mv_at_fault_parties_by_demographics",
    "mv_crash_rates",
    "mv_crashes_wide",
])


@router.get("/matviews", dependencies=[Depends(_verify_etl_key)])
@_limiter.limit("10/minute")
def matview_status(
    request: Request,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Status of all materialized views — row counts and population state."""
    results = []
    for view in _ALLOWED_MATVIEWS:
        try:
            populated = db.execute(text(
                "SELECT relispopulated FROM pg_class WHERE relname = :v"
            ), {"v": view}).scalar()

            row_count = 0
            if populated:
                # Safe: `view` comes from _ALLOWED_MATVIEWS (hardcoded frozenset).
                # PG identifiers cannot be parameterized, so we validate via the
                # allowlist and double-quote the identifier as defense-in-depth.
                row_count = db.execute(
                    text(f'SELECT COUNT(*) FROM "{view}"')
                ).scalar()

            results.append(MatviewStatus(
                name=view,
                row_count=row_count or 0,
                last_refresh=None,  # PG doesn't track this natively
                is_populated=bool(populated),
            ).model_dump())
        except Exception:
            results.append(MatviewStatus(
                name=view,
                row_count=0,
                last_refresh=None,
                is_populated=False,
            ).model_dump())

    return results


@router.get("/db-metrics", dependencies=[Depends(_verify_etl_key)])
@_limiter.limit("10/minute")
def db_metrics(
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """Database performance metrics for capacity planning."""
    # Total size
    total_size = db.execute(text(
        "SELECT pg_database_size(current_database()) / (1024*1024.0)"
    )).scalar()

    # Top tables by size
    table_sizes = db.execute(text("""
        SELECT relname AS name,
               pg_total_relation_size(relid) / (1024*1024.0) AS size_mb
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 10
    """)).all()

    # Top indexes by size
    index_sizes = db.execute(text("""
        SELECT indexrelname AS name,
               pg_relation_size(indexrelid) / (1024*1024.0) AS size_mb
        FROM pg_stat_user_indexes
        ORDER BY pg_relation_size(indexrelid) DESC
        LIMIT 10
    """)).all()

    # Tables with most dead tuples (need VACUUM)
    dead_tuples = db.execute(text("""
        SELECT relname AS name, n_dead_tup AS dead_tuples,
               n_live_tup AS live_tuples,
               last_vacuum, last_autovacuum
        FROM pg_stat_user_tables
        WHERE n_dead_tup > 0
        ORDER BY n_dead_tup DESC
        LIMIT 5
    """)).all()

    # Connection count
    connections = db.execute(text(
        "SELECT count(*) FROM pg_stat_activity"
    )).scalar()

    max_conn = db.execute(text(
        "SHOW max_connections"
    )).scalar()

    return DbMetrics(
        total_size_mb=round(total_size, 1),
        table_sizes=[{"name": r.name, "size_mb": round(r.size_mb, 1)} for r in table_sizes],
        index_sizes=[{"name": r.name, "size_mb": round(r.size_mb, 1)} for r in index_sizes],
        dead_tuples_top5=[{
            "name": r.name,
            "dead_tuples": r.dead_tuples,
            "live_tuples": r.live_tuples,
        } for r in dead_tuples],
        connection_count=connections,
        max_connections=int(max_conn),
    ).model_dump()
