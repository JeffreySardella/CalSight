"""Census-tract crash burden alongside CalEnviroScreen, for the equity layer.

Joins `tract_ces` (one row per CA tract) to `tract_crash_year` (crashes with
coordinates, aggregated per tract per year by etl.compute_tract_crashes).

Two honesty constraints are baked into the response rather than left to the
caller: `summary.coord_share` is the share of crashes in the selected years
that have coordinates at all (the rest are invisible to this layer), and the
response is an association between where crashes are recorded and where
burdened communities are — not evidence that one causes the other.
"""

import time

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import apply_statement_timeout, get_db
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

# Cache-Control only helps a client that has already been here. This is the
# largest response in the API (~9,100 rows, ~1.2 MB before gzip) and every
# cold client pays for the outer join, the GROUP BY and 9,100 model
# validations. Same in-process TTL cache as heatmap.py / clusters.py /
# intersections.py, keyed on the query that produced it. Like those, it can
# serve up to the TTL past an ETL run; the underlying aggregate moves nightly
# at most and the endpoint already promises a day of browser cache.
_TRACT_BURDEN_CACHE_TTL_SECONDS = 6 * 3600
_TRACT_BURDEN_CACHE_MAX = 64
_tract_burden_cache: dict[tuple, tuple[float, TractBurdenOut]] = {}


def clear_tract_burden_cache() -> None:
    """Drop all cached results (tests / manual invalidation)."""
    _tract_burden_cache.clear()


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
# Heavy tier, matching intersections.py / changes.py: at ~1.2 MB a
# response the house 1000/minute default would allow ~1.2 GB/min of
# egress per key.
@_limiter.limit("120/minute;5000/hour")
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

    cache_key = (start, end, frozenset(codes or ()))
    cached = _tract_burden_cache.get(cache_key)
    if cached is not None and cached[0] > time.monotonic():
        return cached[1]

    # Only on a miss — a cache hit should not pay a round-trip to set this.
    # The query is bounded (TractCes outer-joined to a pre-aggregated table,
    # never raw crashes), but every sibling heavy endpoint sets a backstop so a
    # pathological plan cannot hold a pooled connection indefinitely.
    apply_statement_timeout(db, 30_000)

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

    tracts = [
        TractBurdenRow(
            geoid=r.geoid,
            county_code=r.county_code,
            ces_percentile=r.ces_percentile,
            crash_count=r.crash_count,
            killed=r.killed,
            injured=r.injured,
            # Null, not 0, when CES carried no population for the tract: the
            # caller has to tell "no rate available" apart from "no crashes",
            # and label that tract's number in the units it is actually in.
            crashes_per_1k_pop=(
                round(r.crash_count * 1000.0 / r.population, 2)
                if r.population
                else None
            ),
        )
        for r in rows
    ]

    result = TractBurdenOut(
        summary=TractBurdenSummary(
            coord_share=_coord_share(db, start, end, codes),
            tract_count=len(tracts),
            start_year=start,
            end_year=end,
            # Whether the RAMP can be a rate at all. Individual tracts can
            # still lack a population inside a "true" response — that is what
            # each row's null crashes_per_1k_pop means.
            population_available=any(t.crashes_per_1k_pop is not None for t in tracts),
            tracts_without_population=sum(
                1 for t in tracts if t.crashes_per_1k_pop is None
            ),
        ),
        tracts=tracts,
    )

    if len(_tract_burden_cache) >= _TRACT_BURDEN_CACHE_MAX:
        _tract_burden_cache.clear()
    _tract_burden_cache[cache_key] = (
        time.monotonic() + _TRACT_BURDEN_CACHE_TTL_SECONDS, result,
    )
    return result
