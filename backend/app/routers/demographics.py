"""Census ACS demographics per county × year."""

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import (
    parse_county_codes,
    parse_date_range,
    parse_year,
    years_from_date_range,
)
from app.models import Demographic
from app.schemas.demographics import DemographicOut

router = APIRouter(tags=["demographics"])

_limiter = Limiter(key_func=rate_limit_key)


@router.get("/demographics", response_model=list[DemographicOut])
@_limiter.limit("1000/minute;20000/hour")
def list_demographics(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """ACS demographics per county × year. All ~27 columns per row.

    Year filtering accepts either an explicit ``year`` list (?year=2020,2023)
    or a month-resolution date range (?start=YYYY-MM&end=YYYY-MM), which is
    rounded outward to the set of calendar years it spans. The date range
    takes precedence when both are supplied, mirroring the crash endpoints.
    Filtering demographics to the selected years is what keeps per-capita
    denominators (e.g. crashes_per_100k) aligned with the date-filtered crash
    counts — without it the frontend divides an N-year crash count by the
    population summed across *all* seeded years.
    """
    response.headers["Cache-Control"] = "public, max-age=86400, stale-while-revalidate=604800"
    q = db.query(Demographic)
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(Demographic.county_code.in_(codes))

    date_range = parse_date_range(start, end)
    if date_range is not None:
        years = years_from_date_range(date_range)
        if years is not None:
            q = q.filter(Demographic.year.in_(years))
    elif year:
        years = parse_year(year)
        if years:
            q = q.filter(Demographic.year.in_(years))

    rows = q.order_by(Demographic.county_code, Demographic.year).all()
    return [DemographicOut.model_validate(r) for r in rows]
