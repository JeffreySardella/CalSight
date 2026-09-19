"""Census-tract crash burden alongside CalEnviroScreen, for the equity layer.

Joins `tract_ces` (one row per CA tract) to `tract_crash_year` (crashes with
coordinates, aggregated per tract per year by etl.compute_tract_crashes).

Two honesty constraints are baked into the response rather than left to the
caller: `summary.coord_share` is the share of crashes in the selected years
that have coordinates at all (the rest are invisible to this layer), and the
response is an association between where crashes are recorded and where
burdened communities are — not evidence that one causes the other.
"""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes
from app.models import DataQualityStat, TractCes, TractCrashYear
from app.rate_limit import rate_limit_key
from app.schemas.tract_burden import (
    TractBurdenOut,
    TractBurdenRow,
    TractBurdenSummary,
)

router = APIRouter(tags=["tract_burden"])

_limiter = Limiter(key_func=rate_limit_key)

# The aggregate only moves when the ETL reruns (nightly at most) and the
# payload is ~9,100 rows, so a day of browser cache is the point of it.
_ONE_DAY = "public, max-age=86400"


def _coord_share(
    db: Session, start: int | None, end: int | None, codes: set[int] | None
) -> float | None:
    """Share (0-1) of crashes in the window that carry coordinates.

    Read from the precomputed data_quality_stats rather than counting 11.6M
    crash rows. Statewide rows have county_code NULL; when the caller filtered
    to counties we sum those counties' rows instead.
    """
    q = select(
        func.sum(DataQualityStat.crashes_with_coords),
        func.sum(DataQualityStat.total_crashes),
    ).where(DataQualityStat.year.isnot(None))
    if codes:
        q = q.where(DataQualityStat.county_code.in_(codes))
    else:
        q = q.where(DataQualityStat.county_code.is_(None))
    if start is not None:
        q = q.where(DataQualityStat.year >= start)
    if end is not None:
        q = q.where(DataQualityStat.year <= end)

    mapped, total = db.execute(q).one()
    if not total:
        return None
    return round(float(mapped or 0) / float(total), 4)


@router.get("/tract-burden", response_model=TractBurdenOut)
@_limiter.limit("1000/minute;20000/hour")
def tract_burden(
    request: Request,
    response: Response,
    start: int | None = Query(None, ge=1900, le=2100, description="First crash year, inclusive"),
    end: int | None = Query(None, ge=1900, le=2100, description="Last crash year, inclusive"),
    county: str | None = Query(None, description="County slug(s), comma separated"),
    db: Session = Depends(get_db),
):
    """Per-tract crash burden and CES percentile for the selected years."""
    response.headers["Cache-Control"] = _ONE_DAY

    codes = parse_county_codes(county, get_slug_map(db)) if county else None

    # The year filter lives in the JOIN condition, not a WHERE: a tract with
    # no crashes in the window must still come back (with zeroes) so the map
    # can colour it as "low", rather than silently disappearing.
    year_cond = [TractCrashYear.geoid == TractCes.geoid]
    if start is not None:
        year_cond.append(TractCrashYear.year >= start)
    if end is not None:
        year_cond.append(TractCrashYear.year <= end)

    q = (
        select(
            TractCes.geoid,
            TractCes.county_code,
            TractCes.ces_percentile,
            TractCes.population,
            func.coalesce(func.sum(TractCrashYear.crash_count), 0).label("crash_count"),
            func.coalesce(func.sum(TractCrashYear.killed), 0).label("killed"),
            func.coalesce(func.sum(TractCrashYear.injured), 0).label("injured"),
        )
        .select_from(TractCes)
        .outerjoin(TractCrashYear, and_(*year_cond))
        .group_by(
            TractCes.geoid,
            TractCes.county_code,
            TractCes.ces_percentile,
            TractCes.population,
        )
        .order_by(TractCes.geoid)
    )
    if codes:
        q = q.where(TractCes.county_code.in_(codes))

    rows = db.execute(q).all()

    population_available = any(r.population for r in rows)
    tracts = [
        TractBurdenRow(
            geoid=r.geoid,
            county_code=r.county_code,
            ces_percentile=r.ces_percentile,
            crash_count=r.crash_count,
            killed=r.killed,
            injured=r.injured,
            crashes_per_1k_pop=(
                round(r.crash_count * 1000.0 / r.population, 2)
                if r.population
                else None
            ),
        )
        for r in rows
    ]

    return TractBurdenOut(
        summary=TractBurdenSummary(
            coord_share=_coord_share(db, start, end, codes),
            tract_count=len(tracts),
            start_year=start,
            end_year=end,
            population_available=population_available,
        ),
        tracts=tracts,
    )
