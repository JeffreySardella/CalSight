from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EtlRun
from etl.jobs import build_default_registry
from etl.orchestrator import resolve_execution_order

router = APIRouter(tags=["etl"])

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


@router.get("/etl/status")
def etl_status(db: Session = Depends(get_db)):
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
            ) if last else None,
        ))
    return {"sources": [s.model_dump() for s in sources]}


@router.get("/etl/runs")
def etl_runs(
    db: Session = Depends(get_db),
    limit: int = Query(20, le=100),
    source: Optional[str] = None,
):
    query = db.query(EtlRun).order_by(desc(EtlRun.started_at))
    if source:
        query = query.filter(EtlRun.source == source)
    rows = query.limit(limit).all()
    return {
        "runs": [
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
            ).model_dump()
            for r in rows
        ]
    }


@router.post("/etl/run")
def trigger_etl_run(
    background_tasks: BackgroundTasks,
    only: Optional[str] = Query(None, description="Comma-separated job names"),
):
    from etl.orchestrator import run_pipeline

    job_names = only.split(",") if only else None

    def _run():
        run_pipeline(_registry, triggered_by="api", only=job_names)

    background_tasks.add_task(_run)
    return {"status": "started", "jobs": job_names or "all"}
