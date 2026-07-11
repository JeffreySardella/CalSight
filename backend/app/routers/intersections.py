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

import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import Float, and_, case, cast, func, null, select
from sqlalchemy.orm import Session

from app.county_slug_map import get_code, get_slug_map
from app.database import apply_statement_timeout, get_db
from app.models import County, Crash

router = APIRouter(tags=["intersections"])

_limiter = Limiter(key_func=rate_limit_key)

_MAX_LIMIT = 200

# Per-query backstop: these endpoints aggregate the full crashes table when no
# county filter is given (the TTL cache only helps after a first successful
# scan). Kill runaway queries so they release their pool connection instead of
# piling up under load. Comfortably above the observed statewide scan time.
_STATEMENT_TIMEOUT_MS = 30_000

# Relative severity weights for the optional severity-weighted score
# (EPDO-style — "equivalent property-damage-only"). These are a presentation
# choice for ranking, not a statement about the value of a life; an order-of-
# magnitude scale (fatal 100 : injury 10 : pdo 1) kept intentionally modest so
# a single fatality doesn't wholly dominate the ranking. Documented so the
# user knows how "severity-weighted" is computed and can weigh it against the
# plain crash count.
_W_FATAL, _W_INJURY, _W_PDO = 100, 10, 1


class IntersectionOut(BaseModel):
    county_code: int
    county_name: str | None = None
    primary_road: str
    secondary_road: str | None = None
    crash_count: int
    fatal_count: int
    injury_count: int
    pdo_count: int
    severity_score: int
    killed: int
    injured: int
    latitude: float | None = None
    longitude: float | None = None


class ConcentrationBreakpoint(BaseModel):
    """One point on the concentration curve: the top `unit_count` streets
    (a `top_pct` share of all crash-carrying streets) hold `severe_share_pct`
    of the fatal+injury crashes."""
    label: str
    top_pct: int
    unit_count: int
    severe_share_pct: float


class ConcentrationOut(BaseModel):
    """How concentrated fatal+injury crashes are across crash-carrying streets.

    NOTE the denominator is streets that HAVE at least one crash, not all
    roads in the area (CalSight has no total road-mile inventory), so this is
    'X% of crash-carrying streets', not 'X% of road miles'.
    """
    scope: str
    county_code: int | None = None
    county_name: str | None = None
    total_units: int
    total_crashes: int
    total_severe_crashes: int
    breakpoints: list[ConcentrationBreakpoint]


def _norm(col):
    """Normalize a road-name column for grouping: UPPER(collapse-whitespace(TRIM()))."""
    return func.upper(func.regexp_replace(func.trim(col), r"\s+", " ", "g"))


def _street_preds_and_groups(by_secondary, county_code, year_start, year_end):
    """Shared WHERE predicates + GROUP BY columns for street-level queries."""
    primary = _norm(Crash.primary_road)
    preds = [Crash.primary_road.isnot(None), func.trim(Crash.primary_road) != ""]
    group_cols = [primary]
    if by_secondary:
        preds += [Crash.secondary_road.isnot(None), func.trim(Crash.secondary_road) != ""]
        group_cols.append(_norm(Crash.secondary_road))
    if county_code is not None:
        preds.append(Crash.county_code == county_code)
    if year_start is not None:
        preds.append(Crash.crash_year >= year_start)
    if year_end is not None:
        preds.append(Crash.crash_year <= year_end)
    return preds, group_cols


def _aggregate(
    db: Session,
    *,
    by_secondary: bool,
    county_code: int | None,
    year_start: int | None,
    year_end: int | None,
    min_crashes: int,
    limit: int,
    pedestrian: bool | None = None,
    cyclist: bool | None = None,
    sort: str = "count",
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
    if pedestrian is not None:
        preds.append(Crash.pedestrian_involved.is_(pedestrian))
    if cyclist is not None:
        preds.append(Crash.cyclist_involved.is_(cyclist))

    secondary = _norm(Crash.secondary_road) if by_secondary else None

    group_cols = [Crash.county_code, primary]
    if by_secondary:
        group_cols.append(secondary)

    fatal = func.count(case((Crash.severity == "Fatal", 1)))
    injury = func.count(case((Crash.severity == "Injury", 1)))
    pdo = func.count(case((Crash.severity == "Property Damage Only", 1)))
    severity_score = fatal * _W_FATAL + injury * _W_INJURY + pdo * _W_PDO

    primary_order = severity_score.desc() if sort == "severity" else func.count(Crash.id).desc()

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
            severity_score.label("severity_score"),
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
        .order_by(primary_order, fatal.desc())
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
            severity_score=int(r.severity_score or 0),
            killed=int(r.killed or 0),
            injured=int(r.injured or 0),
            latitude=r.latitude,
            longitude=r.longitude,
        )
        for r in rows
    ]


# The /intersections and /corridors aggregations GROUP BY an unindexed
# functional expression on the road-name columns → a full 11M-row seq scan
# with a per-row regexp_replace (~25s cold statewide, the same class of cost
# as street-concentration). The result only changes when ETL loads rows, so —
# exactly like _concentration above — cache the computed list in-process with
# a short TTL, keyed on the FULL argument tuple. Each worker then pays the scan
# at most once per TTL window per filter permutation, not once per visitor.
_AGGREGATE_TTL_SECONDS = 6 * 3600  # matches _CONCENTRATION_TTL_SECONDS
_AGGREGATE_CACHE_MAX = 256
_aggregate_cache: dict[tuple, tuple[float, list[IntersectionOut]]] = {}


def clear_aggregate_cache() -> None:
    """Drop all cached intersection/corridor results (tests / invalidation)."""
    _aggregate_cache.clear()


def _cached_aggregate(
    db: Session,
    *,
    by_secondary: bool,
    county_code: int | None,
    year_start: int | None,
    year_end: int | None,
    min_crashes: int,
    limit: int,
    pedestrian: bool | None,
    cyclist: bool | None,
    sort: str,
) -> list[IntersectionOut]:
    """_aggregate wrapped in the _concentration-style TTL cache.

    Key is every argument the query reads, so any change in filter/sort/limit
    misses and recomputes. The cached list is returned as-is (never mutated),
    keeping responses byte-identical to an uncached run.
    """
    cache_key = (
        by_secondary, county_code, year_start, year_end,
        min_crashes, limit, pedestrian, cyclist, sort,
    )
    hit = _aggregate_cache.get(cache_key)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]
    result = _aggregate(
        db, by_secondary=by_secondary, county_code=county_code,
        year_start=year_start, year_end=year_end, min_crashes=min_crashes,
        limit=limit, pedestrian=pedestrian, cyclist=cyclist, sort=sort,
    )
    if len(_aggregate_cache) >= _AGGREGATE_CACHE_MAX:
        _aggregate_cache.clear()
    _aggregate_cache[cache_key] = (time.monotonic() + _AGGREGATE_TTL_SECONDS, result)
    return result


def _resolve_county(db: Session, county: str | None) -> int | None:
    if not county:
        return None
    code = get_code(county, get_slug_map(db))
    if code is None:
        raise HTTPException(status_code=404, detail=f"Unknown county: {county}")
    return code


# Concentration curve breakpoints: (label, top-percent-of-streets).
_CONCENTRATION_POINTS = [("Top 1%", 1), ("Top 5%", 5), ("Top 10%", 10), ("Top 25%", 25)]

# The statewide concentration aggregation walks every crash-carrying street
# (~2.6M units over 11M crashes) and takes ~25s cold, but its result only
# changes when ETL loads rows. Cache results in-process with a TTL so each
# backend worker pays the scan at most once per TTL window per argument set,
# instead of once per visitor.
_CONCENTRATION_TTL_SECONDS = 6 * 3600
_CONCENTRATION_CACHE_MAX = 256
_concentration_cache: dict[tuple, tuple[float, ConcentrationOut]] = {}


def clear_concentration_cache() -> None:
    """Drop all cached concentration results (tests / manual invalidation)."""
    _concentration_cache.clear()


def _concentration(
    db: Session,
    *,
    by_secondary: bool,
    county_code: int | None,
    county_name: str | None,
    year_start: int | None,
    year_end: int | None,
) -> ConcentrationOut:
    """Compute how concentrated fatal+injury crashes are across streets.

    Aggregates crashes per street, ranks by severe (fatal+injury) count, and
    reports what share of severe crashes the top 1/5/10/25% of crash-carrying
    streets hold. Computed entirely in SQL (CTE + window functions) so the
    long tail never has to leave the database. Results are cached in-process
    for _CONCENTRATION_TTL_SECONDS (see note above).
    """
    cache_key = (by_secondary, county_code, county_name, year_start, year_end)
    hit = _concentration_cache.get(cache_key)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]
    preds, group_cols = _street_preds_and_groups(
        by_secondary, county_code, year_start, year_end,
    )
    severe = func.count(case((Crash.severity.in_(("Fatal", "Injury")), 1)))

    units = (
        select(
            func.count(Crash.id).label("crash_count"),
            severe.label("severe"),
        )
        .select_from(Crash)
        .where(and_(*preds))
        .group_by(*group_cols)
        .subquery()
    )
    ranked = (
        select(
            units.c.crash_count,
            units.c.severe,
            func.row_number().over(order_by=units.c.severe.desc()).label("rn"),
            func.count().over().label("total_units"),
            func.sum(units.c.severe).over().label("total_severe"),
            func.sum(units.c.crash_count).over().label("total_crashes"),
        )
        .subquery()
    )

    cols = [
        func.max(ranked.c.total_units).label("total_units"),
        func.coalesce(func.max(ranked.c.total_severe), 0).label("total_severe"),
        func.coalesce(func.max(ranked.c.total_crashes), 0).label("total_crashes"),
    ]
    for _label, pct in _CONCENTRATION_POINTS:
        cutoff = func.ceil(ranked.c.total_units * (pct / 100.0))
        cols.append(
            func.coalesce(
                func.sum(case((ranked.c.rn <= cutoff, ranked.c.severe), else_=0)), 0
            ).label(f"top{pct}_severe")
        )
        cols.append(
            func.coalesce(
                func.sum(case((ranked.c.rn <= cutoff, 1), else_=0)), 0
            ).label(f"top{pct}_units")
        )

    row = db.execute(select(*cols)).one()

    total_severe = int(row.total_severe or 0)
    breakpoints = []
    for _label, pct in _CONCENTRATION_POINTS:
        severe_in_top = int(getattr(row, f"top{pct}_severe") or 0)
        units_in_top = int(getattr(row, f"top{pct}_units") or 0)
        share = round(severe_in_top / total_severe * 100, 1) if total_severe else 0.0
        breakpoints.append(
            ConcentrationBreakpoint(
                label=_label, top_pct=pct, unit_count=units_in_top,
                severe_share_pct=share,
            )
        )

    out = ConcentrationOut(
        scope="corridors" if not by_secondary else "intersections",
        county_code=county_code,
        county_name=county_name,
        total_units=int(row.total_units or 0),
        total_crashes=int(row.total_crashes or 0),
        total_severe_crashes=total_severe,
        breakpoints=breakpoints,
    )
    if len(_concentration_cache) >= _CONCENTRATION_CACHE_MAX:
        _concentration_cache.clear()
    _concentration_cache[cache_key] = (
        time.monotonic() + _CONCENTRATION_TTL_SECONDS, out,
    )
    return out


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
    pedestrian: bool | None = Query(None, description="Only crashes involving a pedestrian"),
    cyclist: bool | None = Query(None, description="Only crashes involving a bicyclist"),
    sort: Literal["count", "severity"] = Query("count", description="Rank by crash count or by severity-weighted score"),
    db: Session = Depends(get_db),
):
    """Crashes aggregated by (primary_road x secondary_road), ranked by count or severity-weighted score."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    apply_statement_timeout(db, _STATEMENT_TIMEOUT_MS)
    code = _resolve_county(db, county)
    return _cached_aggregate(
        db, by_secondary=True, county_code=code, year_start=year_start,
        year_end=year_end, min_crashes=min_crashes, limit=limit,
        pedestrian=pedestrian, cyclist=cyclist, sort=sort,
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
    pedestrian: bool | None = Query(None, description="Only crashes involving a pedestrian"),
    cyclist: bool | None = Query(None, description="Only crashes involving a bicyclist"),
    sort: Literal["count", "severity"] = Query("count", description="Rank by crash count or by severity-weighted score"),
    db: Session = Depends(get_db),
):
    """Crashes aggregated by primary_road (corridor), ranked by count or severity-weighted score."""
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    apply_statement_timeout(db, _STATEMENT_TIMEOUT_MS)
    code = _resolve_county(db, county)
    return _cached_aggregate(
        db, by_secondary=False, county_code=code, year_start=year_start,
        year_end=year_end, min_crashes=min_crashes, limit=limit,
        pedestrian=pedestrian, cyclist=cyclist, sort=sort,
    )


@router.get("/street-concentration", response_model=ConcentrationOut)
@_limiter.limit("120/minute;5000/hour")
def get_street_concentration(
    request: Request,
    response: Response,
    county: str | None = Query(None, description="County slug; omit for statewide"),
    year_start: int | None = Query(None, ge=2001, le=2100),
    year_end: int | None = Query(None, ge=2001, le=2100),
    scope: Literal["corridors", "intersections"] = Query("corridors", description="Aggregate by single road (corridor) or road pair (intersection)"),
    db: Session = Depends(get_db),
):
    """How concentrated fatal+injury crashes are across crash-carrying streets.

    Returns the share of severe (fatal+injury) crashes held by the top
    1/5/10/25% of streets — the 'a small share of streets carries most of the
    harm' statistic. Denominator is crash-carrying streets, not all road miles
    (see ConcentrationOut). Neutral: the numbers are reported without framing.
    """
    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"
    apply_statement_timeout(db, _STATEMENT_TIMEOUT_MS)
    code = _resolve_county(db, county)
    name = None
    if code is not None:
        name = db.query(County.name).filter(County.code == code).scalar()
    return _concentration(
        db, by_secondary=(scope == "intersections"), county_code=code,
        county_name=name, year_start=year_start, year_end=year_end,
    )
