"""Reference data endpoints: counties, hospitals, schools, road-miles, vmt,
calenviroscreen, traffic-volumes, speed-limits."""

import logging

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.cities_match import normalize_name
from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import (
    CalenviroScreen,
    City,
    County,
    DataQualityStat,
    Hospital,
    RoadMile,
    SchoolLocation,
    SpeedLimit,
    TrafficVolume,
    Vmt,
)
from app.schemas.common import PaginatedResponse
from app.schemas.reference import (
    CalenviroScreenOut,
    CityOut,
    CountyCoordCoverageOut,
    CountyOut,
    HospitalOut,
    RoadMileOut,
    SchoolCrashCountOut,
    SchoolCrashCountsResponse,
    SchoolOut,
    SpeedLimitOut,
    TrafficVolumeOut,
    VmtOut,
)

router = APIRouter(tags=["reference"])

logger = logging.getLogger(__name__)

_limiter = Limiter(key_func=rate_limit_key)

_ONE_HOUR = "public, max-age=3600"


# deprecated (#291): no frontend callers — the map bundles county boundaries
# statically and filters resolve slugs server-side. Kept working for
# external consumers; flagged in OpenAPI so new clients don't adopt it.
@router.get("/counties", response_model=list[CountyOut], deprecated=True)
@_limiter.limit("1000/minute;20000/hour")
def list_counties(
    request: Request,
    response: Response,
    include_geojson: bool = Query(True, description="Include decoded GeoJSON in each row."),
    db: Session = Depends(get_db),
):
    """List all 58 CA counties with lookup and optional GeoJSON boundaries.

    Example: `/api/counties?include_geojson=false`
    """
    response.headers["Cache-Control"] = _ONE_HOUR
    rows = db.query(County).order_by(County.name).all()
    out = [CountyOut.model_validate(row) for row in rows]
    if not include_geojson:
        for row in out:
            row.geojson = None
    return out


# deprecated (#291): no frontend callers — the city autocomplete it was built
# for was never wired up in the UI.
@router.get("/cities", response_model=list[CityOut], deprecated=True)
@_limiter.limit("1000/minute;20000/hour")
def list_cities(
    request: Request,
    response: Response,
    county: str | None = Query(None, description="County slug filter, e.g. 'los-angeles'."),
    search: str | None = Query(None, description="Case-insensitive prefix match on the normalized name."),
    place_type: str | None = Query(None, description="Filter to 'city', 'town', or 'CDP'."),
    limit: int = Query(100, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """List California cities and CDPs for SearchPill autocomplete.

    Example: `/api/cities?county=los-angeles&search=long`
    """
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(City)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(City.county_code.in_(codes))
    if place_type:
        q = q.filter(City.place_type == place_type)
    if search:
        # Match the same normalization the ETL uses so "St. Helena" finds
        # "st helena", "OAKLAND" finds "oakland", etc.
        prefix = normalize_name(search)
        if prefix:
            q = q.filter(City.name_normalized.like(f"{prefix}%"))
    rows = q.order_by(City.name).limit(limit).all()
    return [CityOut.model_validate(r) for r in rows]


@router.get("/hospitals", response_model=list[HospitalOut])
@_limiter.limit("1000/minute;20000/hour")
def list_hospitals(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    trauma_only: bool = Query(False),
    db: Session = Depends(get_db),
):
    """List hospitals with optional county filter and trauma-center-only flag."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(Hospital)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(Hospital.county_code.in_(codes))
    if trauma_only:
        q = q.filter(Hospital.trauma_center.isnot(None))
    return [HospitalOut.model_validate(r) for r in q.all()]


@router.get("/schools", response_model=PaginatedResponse[SchoolOut])
@_limiter.limit("1000/minute;20000/hour")
def list_schools(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    school_type: str | None = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    include_total: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Paginated K-12 schools. ~10K total CA schools, so pagination required."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(SchoolLocation)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(SchoolLocation.county_code.in_(codes))
    if school_type:
        q = q.filter(SchoolLocation.school_type == school_type)
    total: int | None = None
    if include_total:
        total = q.count()
    rows = q.order_by(SchoolLocation.school_name).offset(offset).limit(limit).all()
    return PaginatedResponse[SchoolOut](
        limit=limit,
        offset=offset,
        items=[SchoolOut.model_validate(r) for r in rows],
        total=total,
    )


_SCHOOL_MV = "mv_school_crash_counts"

# Summed over the requested years, one row per school that has at least one
# crash within 500 ft. Schools with none simply aren't in the view; the map
# treats a missing school as zero. See migration 10f264138733 for the
# distance method.
_SCHOOL_CRASH_SQL = """
SELECT s.cds_code       AS cds_code,
       sum(m.crashes)::bigint        AS crashes,
       sum(m.killed)::bigint         AS killed,
       sum(m.injured)::bigint        AS injured,
       sum(m.severe_injured)::bigint AS severe_injured
FROM mv_school_crash_counts m
JOIN school_locations s ON s.id = m.school_id
-- The cast is what lets the all-years case pass an empty list: an untyped
-- '{}' literal has no element type for PG to compare year against.
WHERE (:all_years OR m.year = ANY(CAST(:years AS integer[])))
GROUP BY s.cds_code
"""


def _school_mv_populated(db: Session) -> bool:
    """Whether mv_school_crash_counts exists and has been populated.

    It is created WITH NO DATA (migration 10f264138733) and only becomes
    readable after the first nightly refresh — SELECTing from it before then
    raises "materialized view has not been populated", which would be a 500
    on every map load between deploy and that first refresh. No cache here:
    this endpoint is fetched once per map session, so a catalog lookup per
    request is cheaper than a cache that has to be invalidated in tests.
    """
    try:
        return bool(
            db.execute(
                text(
                    "SELECT relispopulated FROM pg_class "
                    "WHERE relname = :name AND relkind = 'm'"
                ),
                {"name": _SCHOOL_MV},
            ).scalar()
        )
    except Exception:  # noqa: BLE001 — never let the probe break the endpoint
        logger.warning("%s population probe failed; serving no counts", _SCHOOL_MV, exc_info=True)
        return False


def _coord_coverage(db: Session, years: set[int] | None) -> list[CountyCoordCoverageOut]:
    """Per-county share of crashes that carry coordinates, for the caveat line.

    Reads the pre-computed data_quality_stats table rather than grouping the
    11.3M-row crashes table on every request. That table stores one row per
    (county, year) plus a county-level rollup row with year IS NULL, so an
    unfiltered request reads ~58 rows and a filtered one reads 58 x |years|.
    """
    q = (
        db.query(
            DataQualityStat.county_code.label("county_code"),
            County.name.label("county_name"),
            func.coalesce(func.sum(DataQualityStat.total_crashes), 0).label("total_crashes"),
            func.coalesce(func.sum(DataQualityStat.crashes_with_coords), 0).label("with_coords"),
        )
        .outerjoin(County, County.code == DataQualityStat.county_code)
        .filter(DataQualityStat.county_code.isnot(None))
        .group_by(DataQualityStat.county_code, County.name)
    )
    if years:
        q = q.filter(DataQualityStat.year.in_(years))
    else:
        # The all-time rollup row, not a sum over the per-year rows — summing
        # both would double-count every crash.
        q = q.filter(DataQualityStat.year.is_(None))

    out: list[CountyCoordCoverageOut] = []
    for r in q.all():
        total = int(r.total_crashes or 0)
        with_coords = int(r.with_coords or 0)
        if total <= 0:
            continue
        out.append(
            CountyCoordCoverageOut(
                county_code=r.county_code,
                county_name=r.county_name,
                total_crashes=total,
                crashes_with_coords=with_coords,
                coords_pct=round(with_coords / total * 100, 1),
            )
        )
    return sorted(out, key=lambda c: c.county_code)


@router.get("/schools/crash-counts", response_model=SchoolCrashCountsResponse)
@_limiter.limit("1000/minute;20000/hour")
def school_crash_counts(
    request: Request,
    response: Response,
    years: str | None = Query(
        None,
        description="Comma-separated crash years, e.g. '2022,2023'. Omit for all years.",
    ),
    db: Session = Depends(get_db),
):
    """Crashes within 500 ft of each school, for coloring the school markers.

    Returns one row per school that has any nearby crash in the requested
    years, plus the per-county share of crashes that actually carry
    coordinates. That second list is not decoration: coordinate coverage is
    ~37% statewide and varies by reporting agency, so a school in a
    low-coverage county looks safer here than it is.

    Empty `schools` while mv_school_crash_counts is unpopulated (between a
    deploy and the next nightly refresh) rather than a 500.

    Example: `/api/schools/crash-counts?years=2022,2023`
    """
    response.headers["Cache-Control"] = _ONE_HOUR
    parsed = parse_year(years)

    rows: list[SchoolCrashCountOut] = []
    if _school_mv_populated(db):
        result = db.execute(
            text(_SCHOOL_CRASH_SQL),
            {"all_years": parsed is None, "years": sorted(parsed or [])},
        )
        rows = [
            SchoolCrashCountOut(
                cds_code=r.cds_code,
                crashes=int(r.crashes or 0),
                killed=int(r.killed or 0),
                injured=int(r.injured or 0),
                severe_injured=int(r.severe_injured or 0),
            )
            for r in result
        ]

    return SchoolCrashCountsResponse(
        years=sorted(parsed or []),
        schools=rows,
        coverage=_coord_coverage(db, parsed),
    )


@router.get("/calenviroscreen", response_model=list[CalenviroScreenOut])
@_limiter.limit("1000/minute;20000/hour")
def list_calenviroscreen(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """County-level CalEnviroScreen 5.0 scores (population-weighted averages)."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(CalenviroScreen)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(CalenviroScreen.county_code.in_(codes))
    return [CalenviroScreenOut.model_validate(r) for r in q.all()]


# Feeds the map's per-100-road-miles measure (useChoroplethData).
@router.get("/road-miles", response_model=list[RoadMileOut])
@_limiter.limit("1000/minute;20000/hour")
def list_road_miles(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    f_system: int | None = Query(None, ge=1, le=7),
    db: Session = Depends(get_db),
):
    """Caltrans road mileage by county and FHWA functional-system class (1-7)."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(RoadMile)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(RoadMile.county_code.in_(codes))
    if f_system is not None:
        q = q.filter(RoadMile.f_system == f_system)
    return [RoadMileOut.model_validate(r) for r in q.all()]


# Feeds the map's per-100M-vehicle-miles measure (useChoroplethData).
@router.get("/vmt", response_model=list[VmtOut])
@_limiter.limit("1000/minute;20000/hour")
def list_vmt(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """CARB EMFAC vehicle miles traveled by county and year, in millions."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(Vmt)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(Vmt.county_code.in_(codes))
    return [VmtOut.model_validate(r) for r in q.all()]


# deprecated (#291): no frontend callers — AADT exposure feeds /api/stats
# (mv_crash_rates), not this raw per-county list.
@router.get("/traffic-volumes", response_model=list[TrafficVolumeOut], deprecated=True)
@_limiter.limit("1000/minute;20000/hour")
def list_traffic_volumes(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Caltrans AADT summary, one row per county."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(TrafficVolume)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(TrafficVolume.county_code.in_(codes))
    return [TrafficVolumeOut.model_validate(r) for r in q.all()]


# deprecated (#291): no frontend callers.
@router.get("/speed-limits", response_model=list[SpeedLimitOut], deprecated=True)
@_limiter.limit("1000/minute;20000/hour")
def list_speed_limits(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Caltrans posted-speed-limit segment summary, one row per (county, speed)."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(SpeedLimit)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(SpeedLimit.county_code.in_(codes))
    return [SpeedLimitOut.model_validate(r) for r in q.all()]
