"""Context endpoints: unemployment, vehicles, licensed-drivers, data-quality,
insights."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import (
    CountyInsight,
    DataQualityStat,
    LicensedDriver,
    UnemploymentRate,
    VehicleRegistration,
)
from app.schemas.context import (
    CountyInsightOut,
    DataQualityStatOut,
    LicensedDriverOut,
    UnemploymentOut,
    VehicleRegistrationOut,
)

router = APIRouter(tags=["context"])

_FIVE_MIN = "public, max-age=300"


@router.get("/unemployment", response_model=list[UnemploymentOut])
def list_unemployment(
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """BLS monthly unemployment rates per county."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(UnemploymentRate)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(UnemploymentRate.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(UnemploymentRate.year.in_(years))
    rows = q.order_by(
        UnemploymentRate.county_code,
        UnemploymentRate.year,
        UnemploymentRate.month,
    ).all()
    return [UnemploymentOut.model_validate(r) for r in rows]


@router.get("/vehicles", response_model=list[VehicleRegistrationOut])
def list_vehicles(
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """DMV vehicle registrations per county × year, including EV counts."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(VehicleRegistration)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(VehicleRegistration.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(VehicleRegistration.year.in_(years))
    rows = q.order_by(
        VehicleRegistration.county_code, VehicleRegistration.year
    ).all()
    return [VehicleRegistrationOut.model_validate(r) for r in rows]


@router.get("/licensed-drivers", response_model=list[LicensedDriverOut])
def list_licensed_drivers(
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """DMV licensed driver counts per county × year."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(LicensedDriver)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(LicensedDriver.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(LicensedDriver.year.in_(years))
    rows = q.order_by(LicensedDriver.county_code, LicensedDriver.year).all()
    return [LicensedDriverOut.model_validate(r) for r in rows]


@router.get("/data-quality", response_model=list[DataQualityStatOut])
def list_data_quality(
    response: Response,
    county: str | None = Query(None),
    year: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Pre-computed fill rates. NULL in returned rows marks scope:

    - `?county=X&year=Y`  -> specific (county_code=X AND year=Y)
    - `?county=X`         -> per-county all-time (county_code=X AND year IS NULL)
    - `?year=Y`           -> statewide per-year (county_code IS NULL AND year=Y)
    - (no filter)         -> all rows
    """
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(DataQualityStat)

    if county and year is not None:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(
                DataQualityStat.county_code.in_(codes),
                DataQualityStat.year == year,
            )
    elif county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(
                DataQualityStat.county_code.in_(codes),
                DataQualityStat.year.is_(None),
            )
    elif year is not None:
        q = q.filter(
            DataQualityStat.county_code.is_(None),
            DataQualityStat.year == year,
        )

    return [DataQualityStatOut.model_validate(r) for r in q.all()]


@router.get("/insights", response_model=list[CountyInsightOut])
def list_insights(
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """County insight cards with pre-generated narrative.

    Returns `[]` until issue #68 populates `county_insights`.
    """
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(CountyInsight)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(CountyInsight.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(CountyInsight.year.in_(years))
    return [CountyInsightOut.model_validate(r) for r in q.all()]
