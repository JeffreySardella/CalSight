from __future__ import annotations

import hmac
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
)
from pydantic import BaseModel
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EtlRun
from app.settings import settings
from etl.jobs import build_default_registry
from etl.orchestrator import resolve_execution_order

router = APIRouter(tags=["etl"])

_limiter = Limiter(key_func=rate_limit_key)

_registry = build_default_registry()


class LastRun(BaseModel):
    id: int
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    rows_loaded: Optional[int]
    error_message: Optional[str]
    triggered_by: Optional[str]
    validation_status: Optional[str]
    last_source_modified: Optional[datetime] = None
    source_row_count: Optional[int] = None


class SourceStatus(BaseModel):
    name: str
    schedule: str
    depends_on: list[str]
    last_run: Optional[LastRun]


class RunHistoryItem(BaseModel):
    id: int
    source: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime]
    rows_loaded: Optional[int]
    triggered_by: Optional[str]
    validation_status: Optional[str]
    error_message: Optional[str]
    last_source_modified: Optional[datetime] = None
    source_row_count: Optional[int] = None


class EtlStatusResponse(BaseModel):
    sources: list[SourceStatus]


class EtlRunsResponse(BaseModel):
    runs: list[RunHistoryItem]


class EtlTriggerResponse(BaseModel):
    status: str
    # Job names requested, or the literal string "all" when unrestricted.
    jobs: list[str] | str
    force_refresh: bool


def _verify_etl_key(x_etl_api_key: str = Header(None)):
    # no-store on the auth failures too: this dependency raises before the
    # endpoint body sets the header, and a raised HTTPException drops any
    # header set on the injected response (#291).
    no_store = {"Cache-Control": "no-store"}
    if not settings.etl_api_key:
        raise HTTPException(
            status_code=503, detail="ETL API key not configured", headers=no_store
        )
    if not x_etl_api_key or not hmac.compare_digest(x_etl_api_key, settings.etl_api_key):
        raise HTTPException(
            status_code=403, detail="Invalid ETL API key", headers=no_store
        )


@router.get(
    "/etl/status",
    dependencies=[Depends(_verify_etl_key)],
    response_model=EtlStatusResponse,
)
@_limiter.limit("10/minute")
def etl_status(request: Request, response: Response, db: Session = Depends(get_db)):
    # Key-protected operational state — explicitly uncacheable (#291).
    response.headers["Cache-Control"] = "no-store"
    sources: list[SourceStatus] = []
    for job in resolve_execution_order(_registry):
        last = (
            db.query(EtlRun)
            .filter(EtlRun.source == job.name)
            .order_by(desc(EtlRun.started_at))
            .first()
        )
        sources.append(SourceStatus(
            name=job.name,
            schedule=job.schedule,
            depends_on=job.depends_on,
            last_run=LastRun(
                id=last.id,
                status=last.status,
                started_at=last.started_at,
                finished_at=last.finished_at,
                rows_loaded=last.rows_loaded,
                error_message=last.error_message,
                triggered_by=last.triggered_by,
                validation_status=last.validation_status,
                last_source_modified=last.last_source_modified,
                source_row_count=last.source_row_count,
            ) if last else None,
        ))
    return EtlStatusResponse(sources=sources)


@router.get(
    "/etl/runs",
    dependencies=[Depends(_verify_etl_key)],
    response_model=EtlRunsResponse,
)
@_limiter.limit("10/minute")
def etl_runs(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    limit: int = Query(20, le=100),
    source: Optional[str] = None,
):
    # Key-protected operational state — explicitly uncacheable (#291).
    response.headers["Cache-Control"] = "no-store"
    query = db.query(EtlRun).order_by(desc(EtlRun.started_at))
    if source:
        query = query.filter(EtlRun.source == source)
    rows = query.limit(limit).all()
    return EtlRunsResponse(
        runs=[
            RunHistoryItem(
                id=r.id,
                source=r.source,
                status=r.status,
                started_at=r.started_at,
                finished_at=r.finished_at,
                rows_loaded=r.rows_loaded,
                triggered_by=r.triggered_by,
                validation_status=r.validation_status,
                error_message=r.error_message,
                last_source_modified=r.last_source_modified,
                source_row_count=r.source_row_count,
            )
            for r in rows
        ]
    )


def _parse_only(only: Optional[str]) -> Optional[list[str]]:
    """Split the comma-separated job list, tolerating whitespace.

    `?only=parties, victims` must run both jobs — a bare split(",") would
    hand the orchestrator " victims", which matches nothing and silently
    runs zero jobs.
    """
    if not only:
        return None
    return [name.strip() for name in only.split(",") if name.strip()] or None


@router.post(
    "/etl/run",
    dependencies=[Depends(_verify_etl_key)],
    response_model=EtlTriggerResponse,
)
@_limiter.limit("5/minute")
def trigger_etl_run(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    only: Optional[str] = Query(None, description="Comma-separated job names"),
    force_refresh: bool = Query(False, description="Bypass freshness checks"),
):
    from etl.orchestrator import run_pipeline

    # Side-effecting trigger — explicitly uncacheable (#291).
    response.headers["Cache-Control"] = "no-store"
    job_names = _parse_only(only)

    def _run():
        run_pipeline(
            _registry,
            triggered_by="api",
            only=job_names,
            force_refresh=force_refresh,
        )

    background_tasks.add_task(_run)
    return EtlTriggerResponse(
        status="started", jobs=job_names or "all", force_refresh=force_refresh
    )
