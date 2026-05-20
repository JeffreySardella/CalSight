"""NOAA monthly weather data per county."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import Weather
from app.schemas.weather import WeatherOut

router = APIRouter(tags=["weather"])

_limiter = Limiter(key_func=get_remote_address)

_FIVE_MIN = "public, max-age=300"


@router.get("/weather", response_model=list[WeatherOut])
@_limiter.limit("300/minute")
def list_weather(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """NOAA monthly temperature and precipitation per county."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(Weather)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(Weather.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(Weather.year.in_(years))
    rows = q.order_by(
        Weather.county_code,
        Weather.year,
        Weather.month,
    ).all()
    return [WeatherOut.model_validate(r) for r in rows]
