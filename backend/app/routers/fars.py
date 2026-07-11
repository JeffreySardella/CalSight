"""NHTSA FARS fatal-crash aggregates per county."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import FarsCountyYear
from app.schemas.fars import FarsOut

router = APIRouter(tags=["fars"])

_limiter = Limiter(key_func=rate_limit_key)

_FIVE_MIN = "public, max-age=300"


@router.get("/fars", response_model=list[FarsOut])
@_limiter.limit("1000/minute;20000/hour")
def list_fars(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """NHTSA FARS fatality + restraint aggregates per county/year (CA)."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(FarsCountyYear)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(FarsCountyYear.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(FarsCountyYear.year.in_(years))
    rows = q.order_by(FarsCountyYear.county_code, FarsCountyYear.year).all()
    return [FarsOut.model_validate(r) for r in rows]
