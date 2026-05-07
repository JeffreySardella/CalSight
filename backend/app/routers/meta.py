"""Meta endpoints: data freshness, API metadata, coord validation audit."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, case
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes
from app.models import Crash, EtlRun
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


@router.get("/meta/coord-validation")
def coord_validation_summary(response: Response, db: Session = Depends(get_db)):
    """Summary stats for coordinate validation — how many valid/mismatched/unchecked."""
    response.headers["Cache-Control"] = "public, max-age=60"
    row = db.query(
        func.count(Crash.id).label("total_with_coords"),
        func.sum(case((Crash.coord_county_mismatch == True, 1), else_=0)).label("mismatched"),  # noqa: E712
        func.sum(case((Crash.coord_county_mismatch == False, 1), else_=0)).label("valid"),  # noqa: E712
        func.sum(case((Crash.coord_county_mismatch.is_(None), 1), else_=0)).label("unchecked"),
    ).filter(Crash.latitude.isnot(None)).first()
    return {
        "total_with_coords": row.total_with_coords,
        "mismatched": int(row.mismatched or 0),
        "valid": int(row.valid or 0),
        "unchecked": int(row.unchecked or 0),
    }


@router.get("/meta/coord-mismatches")
def coord_mismatches(
    response: Response,
    county: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List crashes flagged as coordinate mismatches — for auditing.

    Returns collision_id, lat/lng, assigned county, and crash date so you
    can plot them on a map or cross-reference with source data.
    """
    response.headers["Cache-Control"] = "no-cache"
    q = db.query(
        Crash.id,
        Crash.collision_id,
        Crash.latitude,
        Crash.longitude,
        Crash.county_code,
        Crash.county_name,
        Crash.crash_datetime,
        Crash.data_source,
        Crash.coord_validated_at,
    ).filter(Crash.coord_county_mismatch == True)  # noqa: E712

    if county:
        slug_map = get_slug_map(db)
        codes = parse_county_codes(county, slug_map)
        if codes:
            q = q.filter(Crash.county_code.in_(codes))

    total = q.count()
    rows = q.order_by(Crash.crash_datetime.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": r.id,
                "collision_id": r.collision_id,
                "latitude": r.latitude,
                "longitude": r.longitude,
                "county_code": r.county_code,
                "county_name": r.county_name,
                "crash_datetime": r.crash_datetime.isoformat() if r.crash_datetime else None,
                "data_source": r.data_source,
                "coord_validated_at": r.coord_validated_at.isoformat() if r.coord_validated_at else None,
            }
            for r in rows
        ],
    }
