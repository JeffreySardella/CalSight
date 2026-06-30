"""Census population-weighted ("lived") density per county."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import TractDensityCountyYear
from app.schemas.tract_density import TractDensityOut

router = APIRouter(tags=["tract_density"])

_limiter = Limiter(key_func=get_remote_address)

_FIVE_MIN = "public, max-age=300"


@router.get("/tract-density", response_model=list[TractDensityOut])
@_limiter.limit("1000/minute;20000/hour")
def list_tract_density(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Population-weighted ("lived") density per county/year (CA)."""
    response.headers["Cache-Control"] = _FIVE_MIN
    q = db.query(TractDensityCountyYear)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(TractDensityCountyYear.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(TractDensityCountyYear.year.in_(years))
    rows = q.order_by(TractDensityCountyYear.county_code, TractDensityCountyYear.year).all()
    return [TractDensityOut.model_validate(r) for r in rows]
