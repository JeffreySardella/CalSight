"""NOAA monthly weather data per county."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import Weather
from app.schemas.weather import WeatherOut

router = APIRouter(tags=["weather"])

_limiter = Limiter(key_func=rate_limit_key)

_FIVE_MIN = "public, max-age=300"


@router.get("/weather", response_model=list[WeatherOut])
@_limiter.limit("1000/minute;20000/hour")
def list_weather(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    # Opt-in pagination (#291) — default None returns the full set because
    # useCorrelationData.ts fetches /api/weather with no params and expects
    # every county × year × month row.
    limit: int | None = Query(None, ge=1, le=100_000),
    offset: int = Query(0, ge=0),
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
    q = q.order_by(
        Weather.county_code,
        Weather.year,
        Weather.month,
    )
    if offset:
        q = q.offset(offset)
    if limit is not None:
        q = q.limit(limit)
    return [WeatherOut.model_validate(r) for r in q.all()]
