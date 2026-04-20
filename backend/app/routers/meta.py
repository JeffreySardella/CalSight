"""Meta endpoints: data freshness, API metadata."""

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EtlRun
from app.schemas.meta import SourceFreshness

router = APIRouter(tags=["meta"])


@router.get("/meta/data-freshness", response_model=dict[str, SourceFreshness])
def data_freshness(response: Response, db: Session = Depends(get_db)):
    """Latest successful ETL run per source (for the 'data as of' pill).

    Backed by `etl_runs`. Returns a dict keyed by source name.
    """
    response.headers["Cache-Control"] = "public, max-age=300"
    subq = (
        db.query(
            EtlRun.source,
            func.max(EtlRun.finished_at).label("last_loaded_at"),
        )
        .filter(EtlRun.status == "success")
        .group_by(EtlRun.source)
        .subquery()
    )
    rows = (
        db.query(EtlRun.source, EtlRun.finished_at, EtlRun.rows_loaded)
        .join(
            subq,
            (EtlRun.source == subq.c.source)
            & (EtlRun.finished_at == subq.c.last_loaded_at),
        )
        .all()
    )
    return {
        source: SourceFreshness(last_loaded_at=finished_at, rows_loaded=rows_loaded)
        for source, finished_at, rows_loaded in rows
    }
