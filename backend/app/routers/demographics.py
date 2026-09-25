"""Census ACS demographics per county × year."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
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

_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800"

# Public column allowlist for `?fields=`. Sourced from the response schema
# (not Demographic.__table__.columns) so internal columns like id/created_at
# can never be requested even though they're real DB columns.
_ALLOWED_FIELDS = set(DemographicOut.model_fields)
_KEY_FIELDS = ("county_code", "year")


def _parse_fields(fields: str | None) -> list[str] | None:
    """Validate a comma-separated column allowlist.

    None (param omitted) means "full response" — the caller keeps the
    existing behavior byte-identical. Every accepted name is looked up with
    getattr() against the ORM model, never spliced into SQL, so an unknown
    name is a 422 rather than a query.
    """
    if fields is None:
        return None
    requested = [f.strip() for f in fields.split(",") if f.strip()]
    unknown = sorted(set(requested) - _ALLOWED_FIELDS)
    if unknown:
        raise HTTPException(422, detail=f"Unknown field(s): {', '.join(unknown)}")
    # Key columns are always selected; de-dupe while keeping key columns first.
    ordered = list(_KEY_FIELDS) + [f for f in requested if f not in _KEY_FIELDS]
    return list(dict.fromkeys(ordered))


@router.get("/demographics", response_model=list[DemographicOut])
@_limiter.limit("1000/minute;20000/hour")
def list_demographics(
    request: Request,
    response: Response,
    county: str | None = Query(None),
    year: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    nearest: bool = Query(
        False,
        description="Also return the nearest available year for requested years with no ACS rows",
    ),
    fields: str | None = Query(
        None,
        description=(
            "Comma-separated column allowlist (e.g. 'population,median_income'). "
            "Omit for the full ~34-column response. Unknown names return 422."
        ),
    ),
    db: Session = Depends(get_db),
):
    """ACS demographics per county × year. All ~27 columns per row.

    Year filtering accepts either an explicit ``year`` list (?year=2020,2023)
    or a month-resolution date range (?start=YYYY-MM&end=YYYY-MM), which is
    rounded outward to the set of calendar years it spans. The date range
    takes precedence when both are supplied, mirroring the crash endpoints.
    With ``nearest=true``, requested years that have no rows yet (ACS lags
    about two years) also pull in the nearest available year. Rows keep their
    real year so the client can label them as estimates.
    Filtering demographics to the selected years is what keeps per-capita
    denominators (e.g. crashes_per_100k) aligned with the date-filtered crash
    counts — without it the frontend divides an N-year crash count by the
    population summed across *all* seeded years.

    ``fields`` trims the SELECT to just the requested columns (plus
    county_code/year) for callers like the map that only need a fraction of
    the ~34 ACS columns — the full response (all columns, list[DemographicOut])
    is the default and is unaffected by this parameter's presence.
    """
    response.headers["Cache-Control"] = _CACHE_CONTROL
    selected = _parse_fields(fields)
    q = (
        db.query(*(getattr(Demographic, f) for f in selected))
        if selected is not None
        else db.query(Demographic)
    )
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes:
            q = q.filter(Demographic.county_code.in_(codes))

    requested: set[int] | None = None
    date_range = parse_date_range(start, end)
    if date_range is not None:
        years = years_from_date_range(date_range)
        if years is not None:
            requested = set(years)
    elif year:
        years = parse_year(year)
        if years:
            requested = set(years)

    if requested is not None:
        wanted = set(requested)
        if nearest:
            have = {y for (y,) in q.with_entities(Demographic.year).distinct()}
            for y in requested - have:
                if have:
                    # Closest year wins; on a tie prefer the later one.
                    wanted.add(min(have, key=lambda h: (abs(h - y), -h)))
        q = q.filter(Demographic.year.in_(wanted))

    rows = q.order_by(Demographic.county_code, Demographic.year).all()
    if selected is not None:
        # Bypass response_model (it would re-inflate every omitted column as
        # null) — return exactly the requested keys via a plain JSONResponse.
        resp = JSONResponse([dict(r._mapping) for r in rows])
        resp.headers["Cache-Control"] = _CACHE_CONTROL
        return resp
    return [DemographicOut.model_validate(r) for r in rows]
