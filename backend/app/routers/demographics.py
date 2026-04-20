"""Census ACS demographics per county × year."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import parse_county_codes, parse_year
from app.models import Demographic
from app.schemas.demographics import DemographicOut

router = APIRouter(tags=["demographics"])


@router.get("/demographics", response_model=list[DemographicOut])
def list_demographics(
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """ACS demographics per county × year. All ~27 columns per row."""
    response.headers["Cache-Control"] = "public, max-age=300"
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
