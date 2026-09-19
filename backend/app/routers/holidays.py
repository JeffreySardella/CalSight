"""GET /api/holidays — crashes, deaths and DUI share on the major holiday
periods, against ordinary days of the same month.

All the date arithmetic and all the division live in `app.holidays`; this
module only turns query params into a day range, pulls one row per day out of
`mv_crashes_by_day`, and caches the answer.

The view is refreshed nightly and created WITH NO DATA, so on a fresh deploy it
is empty for one refresh cycle. That returns `holidays: []` with a 200 — the
story block renders nothing rather than the page showing an error.
"""

from __future__ import annotations

import logging
import time
from datetime import date

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import apply_statement_timeout, get_db
from app.filters import FilterError, parse_county_codes
from app.holidays import summarize
from app.models import County
from app.rate_limit import rate_limit_key
from app.schemas.holidays import HolidaysOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["holidays"])

_limiter = Limiter(key_func=rate_limit_key)

_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
_MV_NAME = "mv_crashes_by_day"

# The story's default span. 2016 is where CCRS begins and the involvement
# flags become meaningful; the upper end is clamped to the last complete year.
FIRST_YEAR = 2016

# Same in-process TTL cache the clusters/heatmap endpoints use: the answer
# changes once a night at most, and there are only a few dozen distinct
# (years, county) keys, so each worker pays the query once per window.
_CACHE_TTL_SECONDS = 6 * 3600
_CACHE_MAX = 200
_cache: dict[tuple, tuple[float, HolidaysOut]] = {}


def clear_holidays_cache() -> None:
    """Test hook: drop every cached holiday payload."""
    _cache.clear()


def last_complete_year(today: date | None = None) -> int:
    """The newest year whose crash data is worth reporting.

    Deaths lag six months or more behind crashes, so the current year is never
    included — a partial year would read as a collapse in fatalities.
    """
    return (today or date.today()).year - 1


def parse_years(raw: str | None) -> tuple[int, int]:
    """`?years=2016-2025` -> (2016, 2025), clamped to complete years."""
    ceiling = last_complete_year()
    if not raw:
        return FIRST_YEAR, ceiling
    parts = raw.split("-")
    if len(parts) != 2 or not all(p.strip().isdigit() for p in parts):
        raise FilterError("years", f"years must look like '2016-{ceiling}'.")
    first, last = (int(p) for p in parts)
    if first < FIRST_YEAR or last > ceiling or first > last:
        raise FilterError(
            "years",
            f"years must be a range inside {FIRST_YEAR}-{ceiling} "
            "(the current year is excluded because deaths lag six months).",
        )
    return first, last


def one_county_code(raw: str | None, slug_map: dict[str, int]) -> int | None:
    """`?county=` — exactly one slug, or None for statewide."""
    codes = parse_county_codes(raw, slug_map)
    if codes is None:
        return None
    if len(codes) != 1:
        raise FilterError("county", "county must be a single county slug, e.g. los-angeles")
    return next(iter(codes))


def _mv_populated(db: Session) -> bool:
    """Whether mv_crashes_by_day exists and has been populated at least once."""
    try:
        return bool(db.execute(
            text("SELECT relispopulated FROM pg_class WHERE relname = :n AND relkind = 'm'"),
            {"n": _MV_NAME},
        ).scalar())
    except Exception:  # noqa: BLE001 — a probe must never break the endpoint
        logger.warning("%s population probe failed", _MV_NAME, exc_info=True)
        return False


def daily_counts(
    db: Session, start: date, end: date, county_code: int | None
) -> dict[date, tuple[int, int, int]]:
    """day -> (crashes, killed, dui_crashes) over [start, end].

    Statewide this rolls the 58 county rows per day up in SQL, so at most
    ~3,700 rows cross the wire for a ten-year window.
    """
    sql = (
        "SELECT day, SUM(crashes)::int, SUM(killed)::int, SUM(dui_crashes)::int "
        f"FROM {_MV_NAME} WHERE day BETWEEN :start AND :end"
    )
    params: dict[str, object] = {"start": start, "end": end}
    if county_code is not None:
        sql += " AND county_code = :code"
        params["code"] = county_code
    sql += " GROUP BY day"
    return {r[0]: (r[1], r[2], r[3]) for r in db.execute(text(sql), params)}


def build_holidays(db: Session, first: int, last: int, county_code: int | None) -> HolidaysOut:
    """The full payload for one (year range, county) combination."""
    county_name = None
    if county_code is not None:
        county_name = db.query(County.name).filter(County.code == county_code).scalar()

    if not _mv_populated(db):
        return HolidaysOut(
            first_year=first, last_year=last,
            county_code=county_code, county_name=county_name, holidays=[],
        )

    window = (date(first, 1, 1), date(last, 12, 31))
    daily = daily_counts(db, window[0], window[1], county_code)
    return HolidaysOut(
        first_year=first,
        last_year=last,
        county_code=county_code,
        county_name=county_name,
        holidays=summarize(daily, range(first, last + 1), window),
    )


@router.get("/holidays", response_model=HolidaysOut)
@_limiter.limit("120/minute;5000/hour")
def get_holidays(
    request: Request,
    response: Response,
    years: str | None = Query(None, description="Year range, e.g. 2016-2025"),
    county: str | None = Query(None, description="County slug, e.g. los-angeles"),
    db: Session = Depends(get_db),
):
    """Holiday-period crash, death and DUI rates against ordinary days of the
    same month, pooled over complete years."""
    apply_statement_timeout(db, 30_000)
    response.headers["Cache-Control"] = _CACHE

    first, last = parse_years(years)
    code = one_county_code(county, get_slug_map(db))

    key = (first, last, code)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit is not None and hit[0] > now:
        return hit[1]

    result = build_holidays(db, first, last, code)
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()
    _cache[key] = (now + _CACHE_TTL_SECONDS, result)
    return result
