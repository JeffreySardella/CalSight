"""GET /api/fog-days — crashes on NWS dense-fog days vs the same months without one.

Computed live from `storm_events` (loaded by etl/load_storm_events.py) and
`crashes`. Small enough to stay live: the zone map covers ~20 counties and the
crash record starts in 2001, and the answer is cached for an hour.

What the numbers mean, precisely:
  fog_event_days   — county-days covered by a NOAA "Dense Fog" event. NOAA keys
                     these to NWS forecast zones, and a zone can straddle a
                     county line, so a fog day here means "a dense-fog advisory
                     covered part of this county", not "this county was fogged in".
  baseline         — every other day in the SAME calendar months, so a winter
                     month is compared against winter, not against July.
  fog_coded_crashes— crashes whose own weather field says fog
                     (canonical_weather = 'fog'), for the same months. An
                     independent signal from the advisories, not a subset.

Association only: crashes and fog advisories co-occur; neither column can show
that the fog caused a crash.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import cast, func, select, tuple_
from sqlalchemy.orm import Session
from sqlalchemy.types import Date

from app.county_slug_map import get_slug_map, slugify_name
from app.database import apply_statement_timeout, get_db
from app.filters import FilterError, parse_county_codes
from app.models import County, Crash, StormEvent
from app.rate_limit import rate_limit_key
from app.schemas.fog_days import FogCounty, FogDaysOut, FogYear
from etl.compute_first_rain import compute_lift, crash_data_through
from etl.load_storm_events import FOG_EVENT_TYPE

router = APIRouter(tags=["fog-days"])

_limiter = Limiter(key_func=rate_limit_key)

_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
# A fog advisory that claims to run for weeks is a bad row, not a fog spell.
_MAX_EVENT_DAYS = 14


def _event_days(begin: date, end: date) -> list[date]:
    span = min((end - begin).days, _MAX_EVENT_DAYS)
    return [begin + timedelta(days=i) for i in range(span + 1)]


def _year_record(
    year: int,
    fog_days: set[date],
    months: set[int],
    through: date,
    on_fog: int,
    off_fog: int,
    fog_coded: int,
) -> FogYear:
    """One county-year (or the roll-up of several) as an API row."""
    in_scope = {d for d in fog_days if d.month in months and d <= through}
    scope_days = sum(
        min(calendar.monthrange(year, m)[1], (through - date(year, m, 1)).days + 1)
        for m in months
        if date(year, m, 1) <= through
    )
    baseline_days = max(scope_days - len(in_scope), 0)
    fog_avg = on_fog / len(in_scope) if in_scope else 0.0
    base_avg = off_fog / baseline_days if baseline_days else 0.0
    return FogYear(
        year=year,
        fog_event_days=len(in_scope),
        crashes_on_fog_days=on_fog,
        fog_day_avg_crashes=round(fog_avg, 2),
        baseline_days=baseline_days,
        baseline_avg_crashes=round(base_avg, 2),
        lift_pct=compute_lift(fog_avg, base_avg),
        fog_coded_crashes=fog_coded,
    )


def _roll_up(year: int, rows: list[FogYear]) -> FogYear:
    """Sum county rows (or year rows) into one, re-deriving the averages."""
    fog_days = sum(r.fog_event_days for r in rows)
    base_days = sum(r.baseline_days for r in rows)
    on_fog = sum(r.crashes_on_fog_days for r in rows)
    base_crashes = sum(round(r.baseline_avg_crashes * r.baseline_days) for r in rows)
    fog_avg = on_fog / fog_days if fog_days else 0.0
    base_avg = base_crashes / base_days if base_days else 0.0
    return FogYear(
        year=year,
        fog_event_days=fog_days,
        crashes_on_fog_days=on_fog,
        fog_day_avg_crashes=round(fog_avg, 2),
        baseline_days=base_days,
        baseline_avg_crashes=round(base_avg, 2),
        lift_pct=compute_lift(fog_avg, base_avg),
        fog_coded_crashes=sum(r.fog_coded_crashes for r in rows),
    )


def build_fog_days(db: Session, county: str | None, year: int | None) -> FogDaysOut:
    """Per county × year fog-day crash comparison, plus year and overall roll-ups."""
    codes: set[int] | None = None
    if county:
        codes = parse_county_codes(county, get_slug_map(db))
        if codes is None or len(codes) != 1:
            raise FilterError("county", "county must be exactly one county slug, e.g. fresno")

    q = select(StormEvent.county_code, StormEvent.begin_date, StormEvent.end_date).where(
        StormEvent.event_type == FOG_EVENT_TYPE
    )
    if codes:
        q = q.where(StormEvent.county_code.in_(codes))
    if year:
        q = q.where(StormEvent.begin_date.between(date(year, 1, 1), date(year, 12, 31)))
    events = db.execute(q).all()

    # (county, calendar year) -> the days a dense-fog advisory covered.
    fog_by: dict[tuple[int, int], set[date]] = {}
    for code, begin, end in events:
        for day in _event_days(begin, end):
            if year and day.year != year:
                continue
            fog_by.setdefault((code, day.year), set()).add(day)

    through = crash_data_through(db)
    names = dict(db.execute(select(County.code, County.name)).all())
    months = sorted({d.month for days in fog_by.values() for d in days})
    newest = max((y for _, y in fog_by), default=None)

    if not fog_by or through is None:
        return FogDaysOut(
            county=county, year=year, fog_event_type=FOG_EVENT_TYPE,
            months=months, storm_events_through=newest,
            totals=None, years=[], counties=[],
        )

    fog_pairs = sorted({(code, day) for (code, _), days in fog_by.items() for day in days})
    scope_codes = sorted({code for code, _ in fog_by})
    scope_years = sorted({y for _, y in fog_by})

    day_col = cast(Crash.crash_datetime, Date)
    is_fog_day = tuple_(Crash.county_code, day_col).in_(fog_pairs)
    counts = db.execute(
        select(
            Crash.county_code,
            Crash.crash_year,
            func.count().filter(is_fog_day),
            func.count().filter(~is_fog_day),
            func.count().filter(Crash.canonical_weather == "fog"),
        )
        .where(
            Crash.county_code.in_(scope_codes),
            Crash.crash_year.in_(scope_years),
            Crash.crash_month.in_(months),
        )
        .group_by(Crash.county_code, Crash.crash_year)
    ).all()
    by_key = {(code, yr): (on, off, coded) for code, yr, on, off, coded in counts}

    per_county: dict[int, list[FogYear]] = {}
    for (code, yr), days in sorted(fog_by.items()):
        on, off, coded = by_key.get((code, yr), (0, 0, 0))
        record = _year_record(yr, days, set(months), through, on, off, coded)
        if record.fog_event_days == 0:
            continue  # the whole spell falls past the end of the crash record
        per_county.setdefault(code, []).append(record)

    counties = [
        FogCounty(
            county_code=code,
            county_name=names.get(code, str(code)),
            county_slug=slugify_name(names.get(code, str(code))),
            years=rows,
        )
        for code, rows in sorted(per_county.items())
    ]
    by_year: dict[int, list[FogYear]] = {}
    for rows in per_county.values():
        for row in rows:
            by_year.setdefault(row.year, []).append(row)
    years = [_roll_up(yr, rows) for yr, rows in sorted(by_year.items())]

    return FogDaysOut(
        county=county,
        year=year,
        fog_event_type=FOG_EVENT_TYPE,
        months=months,
        storm_events_through=newest,
        totals=_roll_up(years[-1].year, years) if years else None,
        years=years,
        counties=counties,
    )


@router.get("/fog-days", response_model=FogDaysOut)
@_limiter.limit("120/minute;5000/hour")
def get_fog_days(
    request: Request,
    response: Response,
    county: str | None = Query(None, description="County slug, e.g. fresno; omit for statewide"),
    year: int | None = Query(None, ge=2001, le=2100),
    db: Session = Depends(get_db),
):
    """Crashes on dense-fog-advisory days vs the same months without one."""
    # ponytail: the crash side is a grouped scan of the fog-season months for
    # the mapped counties (~20 counties x ~5 months x 25 years). It is bounded
    # and cached for an hour; if it ever shows up slow, the upgrade is a
    # per-county-day crash matview, not a rewrite of this endpoint.
    apply_statement_timeout(db, 30_000)
    response.headers["Cache-Control"] = _CACHE
    return build_fog_days(db, county, year)
