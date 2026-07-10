"""Reference data endpoints: counties, hospitals, schools, road-miles,
calenviroscreen, traffic-volumes, speed-limits."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy.orm import Session

from app.cities_match import normalize_name
from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes
from app.models import (
    CalenviroScreen,
    City,
    County,
    Hospital,
    RoadMile,
    SchoolLocation,
    SpeedLimit,
    TrafficVolume,
)
from app.schemas.common import PaginatedResponse
from app.schemas.reference import (
    CalenviroScreenOut,
    CityOut,
    CountyOut,
    HospitalOut,
    RoadMileOut,
    SchoolOut,
    SpeedLimitOut,
    TrafficVolumeOut,
)

router = APIRouter(tags=["reference"])

_limiter = Limiter(key_func=rate_limit_key)

_ONE_HOUR = "public, max-age=3600"


@router.get("/counties", response_model=list[CountyOut])
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


@router.get("/cities", response_model=list[CityOut])
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


@router.get("/calenviroscreen", response_model=list[CalenviroScreenOut])
@_limiter.limit("1000/minute;20000/hour")
def list_calenviroscreen(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """County-level CalEnviroScreen 4.0 scores (population-weighted averages)."""
    response.headers["Cache-Control"] = _ONE_HOUR
    q = db.query(CalenviroScreen)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(CalenviroScreen.county_code.in_(codes))
    return [CalenviroScreenOut.model_validate(r) for r in q.all()]


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


@router.get("/traffic-volumes", response_model=list[TrafficVolumeOut])
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


@router.get("/speed-limits", response_model=list[SpeedLimitOut])
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
