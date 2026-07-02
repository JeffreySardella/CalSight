"""GET /api/intersections and /api/corridors — street-level crash aggregation.

CalSight's finest neutral geographic cut has been county → raw dots. These
endpoints add a street-level scope by grouping crashes on the road names the
crash report itself carries (`primary_road`, `secondary_road`):

- **Intersection** = a (primary_road × secondary_road) pair within a county.
- **Corridor**     = a single primary_road within a county.

This is the "road-pair" model: it uses data already in hand (no external road
network) and mirrors how report-based tools define an intersection. Road names
are normalized (upper-cased, trimmed, internal whitespace collapsed) so
"Main St" and "MAIN  ST" group together.

Presentation is neutral: results are returned ranked by crash count (the
caller can re-sort). No "deadliest"/"dangerous" labeling — CalSight presents
the counts and lets the reader draw conclusions.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import Float, and_, case, cast, func, null, select
from sqlalchemy.orm import Session

from app.county_slug_map import get_code, get_slug_map
from app.database import get_db
from app.models import County, Crash

router = APIRouter(tags=["intersections"])

_limiter = Limiter(key_func=get_remote_address)

_MAX_LIMIT = 200


class IntersectionOut(BaseModel):
    county_code: int
    county_name: str | None = None
    primary_road: str
    secondary_road: str | None = None
    crash_count: int
    fatal_count: int
    injury_count: int
    pdo_count: int
    killed: int
    injured: int
    latitude: float | None = None
    longitude: float | None = None


def _norm(col):
    """Normalize a road-name column for grouping: UPPER(collapse-whitespace(TRIM()))."""
    return func.upper(func.regexp_replace(func.trim(col), r"\s+", " ", "g"))


def _aggregate(
    db: Session,
    *,
    by_secondary: bool,
    county_code: int | None,
    year_start: int | None,
    year_end: int | None,
    min_crashes: int,
    limit: int,
) -> list[IntersectionOut]:
    primary = _norm(Crash.primary_road)
    preds = [Crash.primary_road.isnot(None), func.trim(Crash.primary_road) != ""]
    if by_secondary:
        preds += [Crash.secondary_road.isnot(None), func.trim(Crash.secondary_road) != ""]
    if county_code is not None:
        preds.append(Crash.county_code == county_code)
    if year_start is not None:
        preds.append(Crash.crash_year >= year_start)
    if year_end is not None:
        preds.append(Crash.crash_year <= year_end)

    secondary = _norm(Crash.secondary_road) if by_secondary else None

    group_cols = [Crash.county_code, primary]
    if by_secondary:
        group_cols.append(secondary)

    fatal = func.count(case((Crash.severity == "Fatal", 1)))
    injury = func.count(case((Crash.severity == "Injury", 1)))
    pdo = func.count(case((Crash.severity == "Property Damage Only", 1)))

    stmt = (
        select(
            Crash.county_code.label("county_code"),
            County.name.label("county_name"),
            primary.label("primary_road"),
            (secondary.label("secondary_road") if by_secondary else null().label("secondary_road")),
            func.count(Crash.id).label("crash_count"),
            fatal.label("fatal_count"),
            injury.label("injury_count"),
            pdo.label("pdo_count"),
            func.coalesce(func.sum(Crash.number_killed), 0).label("killed"),
            func.coalesce(func.sum(Crash.number_injured), 0).label("injured"),
            cast(func.avg(Crash.latitude), Float).label("latitude"),
            cast(func.avg(Crash.longitude), Float).label("longitude"),
        )
        .select_from(Crash)
        .join(County, County.code == Crash.county_code, isouter=True)
        .where(and_(*preds))
        .group_by(*group_cols, County.name)
        .having(func.count(Crash.id) >= min_crashes)
        .order_by(func.count(Crash.id).desc(), fatal.desc())
        .limit(limit)
    )

    rows = db.execute(stmt).all()
    return [
        IntersectionOut(
            county_code=r.county_code,
            county_name=r.county_name,
            primary_road=r.primary_road,
            secondary_road=r.secondary_road if by_secondary else None,
            crash_count=r.crash_count,
            fatal_count=r.fatal_count,
            injury_count=r.injury_count,
            pdo_count=r.pdo_count,
            killed=int(r.killed or 0),
            injured=int(r.injured or 0),
            latitude=r.latitude,
            longitude=r.longitude,
        )
        for r in rows
    ]


def _resolve_county(db: Session, county: str | None) -> int | None:
    if not county:
        return None
    code = get_code(county, get_slug_map(db))
    if code is None:
        raise HTTPException(status_code=404, detail=f"Unknown county: {county}")
    return code


@router.get("/intersections", response_model=list[IntersectionOut])
@_limiter.limit("120/minute;5000/hour")
def get_intersections(
    request: Request,
    response: Response,
    county: str | None = Query(None, description="County slug (e.g. los-angeles); omit for statewide"),
    year_start: int | None = Query(None, ge=2001, le=2100),
    year_end: int | None = Query(None, ge=2001, le=2100),
    min_crashes: int = Query(2, ge=1, le=1000, description="Minimum crashes for an intersection to appear"),
    limit: int = Query(25, ge=1, le=_MAX_LIMIT),
    db: Session = Depends(get_db),
):
    """Crashes aggregated by (primary_road x secondary_road), ranked by count."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    code = _resolve_county(db, county)
    return _aggregate(
        db, by_secondary=True, county_code=code, year_start=year_start,
        year_end=year_end, min_crashes=min_crashes, limit=limit,
    )


@router.get("/corridors", response_model=list[IntersectionOut])
@_limiter.limit("120/minute;5000/hour")
def get_corridors(
    request: Request,
    response: Response,
    county: str | None = Query(None, description="County slug; omit for statewide"),
    year_start: int | None = Query(None, ge=2001, le=2100),
    year_end: int | None = Query(None, ge=2001, le=2100),
    min_crashes: int = Query(5, ge=1, le=5000),
    limit: int = Query(25, ge=1, le=_MAX_LIMIT),
    db: Session = Depends(get_db),
):
    """Crashes aggregated by primary_road (corridor), ranked by count."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    code = _resolve_county(db, county)
    return _aggregate(
        db, by_secondary=False, county_code=code, year_start=year_start,
        year_end=year_end, min_crashes=min_crashes, limit=limit,
    )
