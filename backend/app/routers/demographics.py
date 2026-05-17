"""Census ACS demographics per county × year."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import Demographic
from app.schemas.demographics import DemographicOut

router = APIRouter(tags=["demographics"])

_limiter = Limiter(key_func=get_remote_address)


@router.get("/demographics", response_model=list[DemographicOut])
@_limiter.limit("30/minute")
def list_demographics(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """ACS demographics per county × year. All ~27 columns per row."""
    response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=604800"
    q = db.query(Demographic)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(Demographic.county_code.in_(codes))
    if year:
        years = parse_year(year)
        if years:
            q = q.filter(Demographic.year.in_(years))
    rows = q.order_by(Demographic.county_code, Demographic.year).all()
    return [DemographicOut.model_validate(r) for r in rows]
