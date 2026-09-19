"""GET /api/fog-days — crashes on NWS dense-fog days vs the same months without one.

Computed live from `storm_events` (loaded by etl/load_storm_events.py) and
`crashes`. Small enough to stay live: the zone map covers ~30 counties and the
crash record starts in 2001, and the answer is cached for an hour.

What the numbers mean, precisely:
  fog_event_days   — county-days covered by a NOAA "Dense Fog" event. NOAA keys
                     these to NWS forecast zones, and a zone can straddle a
                     county line, so a fog day here means "a dense-fog advisory
                     covered part of this county", not "this county was fogged in".
  baseline         — every other day in the SAME calendar months, restricted to
                     the fog season (FOG_MONTHS), so a winter month is compared
                     against winter and one stray summer advisory somewhere in
                     the state cannot widen every county's comparison window.
  fog_coded_crashes— crashes whose own weather field says fog
                     (canonical_weather = 'fog'), for the same months. An
                     independent signal from the advisories, not a subset.

Query shape matters here: this is a public, unauthenticated endpoint on the
database that also serves the live site. The fog (county, day) pairs go in as
two parallel arrays joined through `unnest`, so Postgres builds one hash and
probes it — sending them as a row-comparison IN list expands to an OR chain
tested against every surviving row. The baseline is `count(*) - fog_count`
rather than a second, negated copy of the same list.

Association only: crashes and fog advisories co-occur; neither column can show
that the fog caused a crash.
"""

from __future__ import annotations

import calendar
import time
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session
from sqlalchemy.types import Date

from app.county_slug_map import get_slug_map, slugify_name
from app.database import apply_statement_timeout, get_db
from app.filters import FilterError, parse_county_codes
from app.models import County, Crash, StormEvent
from app.rate_limit import rate_limit_key
from app.schemas.fog_days import FogCounty, FogDaysOut, FogYear
from etl.compute_first_rain import compute_lift
from etl.load_storm_events import FOG_EVENT_TYPE, MAPPED_COUNTY_CODES

router = APIRouter(tags=["fog-days"])

_limiter = Limiter(key_func=rate_limit_key)

_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
# A fog advisory that claims to run for weeks is a bad row, not a fog spell.
_MAX_EVENT_DAYS = 14
# Tule fog season. The baseline window is this set intersected with the months
# advisories were actually issued in, never the raw union: one June advisory in
# a desert county would otherwise pull June into the comparison window for
# every county and every year, and the story copy promises winter.
FOG_MONTHS = frozenset({11, 12, 1, 2, 3})


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
    """One county-year as an API row."""
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
        crashes_off_fog_days=off_fog,
        baseline_avg_crashes=round(base_avg, 2),
        lift_pct=compute_lift(fog_avg, base_avg),
        fog_coded_crashes=fog_coded,
    )


def _roll_up(year: int | None, rows: list[FogYear]) -> FogYear:
    """Sum county rows (or year rows) into one, re-deriving the averages.

    `year` is None for a whole-period total — stamping 25 years of totals with
    the newest year read as a single-year figure.
    """
    fog_days = sum(r.fog_event_days for r in rows)
    base_days = sum(r.baseline_days for r in rows)
    on_fog = sum(r.crashes_on_fog_days for r in rows)
    off_fog = sum(r.crashes_off_fog_days for r in rows)
    fog_avg = on_fog / fog_days if fog_days else 0.0
    base_avg = off_fog / base_days if base_days else 0.0
    return FogYear(
        year=year,
        fog_event_days=fog_days,
        crashes_on_fog_days=on_fog,
        fog_day_avg_crashes=round(fog_avg, 2),
        baseline_days=base_days,
        crashes_off_fog_days=off_fog,
        baseline_avg_crashes=round(base_avg, 2),
        lift_pct=compute_lift(fog_avg, base_avg),
        fog_coded_crashes=sum(r.fog_coded_crashes for r in rows),
    )


def _crash_data_through(db: Session, codes: list[int]) -> date | None:
    """Newest crash date within `codes` (clamped to today against stray futures).

    Bounded to the counties in scope on purpose: `crashes` has no index leading
    on crash_datetime (it was dropped in the schema-hardening migration), but
    ix_crashes_county_datetime leads on county_code, so a bounded max() is a
    handful of backward index scans instead of a seq scan of 11.3M rows.
    """
    newest = db.execute(
        select(func.max(Crash.crash_datetime)).where(Crash.county_code.in_(codes))
    ).scalar()
    return min(newest.date(), date.today()) if newest else None


def _fog_pair_join(pairs: list[tuple[int, date]]):
    """The fog (county, day) pairs as a joinable relation Postgres can hash.

    `unnest(:codes::int[], :days::date[])` sends two parallel arrays as bound
    parameters — one hash build, one probe per crash row — instead of a
    306 KB row-comparison IN list that expands into an OR chain.
    """
    codes = [code for code, _ in pairs]
    days = [day for _, day in pairs]
    return (
        func.unnest(cast(codes, ARRAY(Integer)), cast(days, ARRAY(Date)))
        .table_valued("county_code", "day")
        .render_derived(name="fog", with_types=False)
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
            if day.month not in FOG_MONTHS:
                continue
            fog_by.setdefault((code, day.year), set()).add(day)

    months = sorted({d.month for days in fog_by.values() for d in days})
    newest_year = max((y for _, y in fog_by), default=None)
    empty = FogDaysOut(
        county=county, year=year, fog_event_type=FOG_EVENT_TYPE,
        months=months, storm_events_through=newest_year,
        totals=None, years=[], counties=[],
    )
    if not fog_by:
        return empty

    # Bound every crash query to counties the zone map can speak about at all;
    # this is also what makes the max(crash_datetime) probe index-servable.
    scope_codes = sorted({code for code, _ in fog_by} & MAPPED_COUNTY_CODES)
    if not scope_codes:
        return empty
    scope_years = sorted({y for code, y in fog_by if code in scope_codes})

    through = _crash_data_through(db, scope_codes)
    if through is None:
        return empty

    fog_pairs = sorted(
        {(code, day) for (code, _), days in fog_by.items() if code in scope_codes
         for day in days}
    )
    fog = _fog_pair_join(fog_pairs)
    day_col = cast(Crash.crash_datetime, Date)
    counts = db.execute(
        select(
            Crash.county_code,
            Crash.crash_year,
            func.count().filter(fog.c.day.isnot(None)),
            func.count().filter(Crash.canonical_weather == "fog"),
            func.count(),
        )
        .select_from(Crash)
        .outerjoin(
            fog,
            (fog.c.county_code == Crash.county_code) & (fog.c.day == day_col),
        )
        .where(
            Crash.county_code.in_(scope_codes),
            Crash.crash_year.in_(scope_years),
            Crash.crash_month.in_(months),
        )
        .group_by(Crash.county_code, Crash.crash_year)
    ).all()
    # Baseline is the remainder, never a second negated copy of the pair list.
    by_key = {
        (code, yr): (on_fog, total - on_fog, coded)
        for code, yr, on_fog, coded, total in counts
    }

    names = dict(db.execute(select(County.code, County.name)).all())
    per_county: dict[int, list[FogYear]] = {}
    for (code, yr), days in sorted(fog_by.items()):
        if code not in scope_codes:
            continue
        on_fog, off_fog, coded = by_key.get((code, yr), (0, 0, 0))
        record = _year_record(yr, days, set(months), through, on_fog, off_fog, coded)
        if record.fog_event_days == 0:
            continue  # the whole spell falls past the end of the crash record
        per_county.setdefault(code, []).append(record)

    if not per_county:
        return empty

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
        storm_events_through=newest_year,
        totals=_roll_up(None, years),
        years=years,
        counties=counties,
    )


# The unfiltered request — the default state of the tule-fog story — resolves
# to every mapped county × every year with a recorded fog event, then groups
# `crashes` over that whole scope. That is a large fraction of an 11M-row table
# scanned live on each cold request. The inputs only change when ETL loads rows,
# so cache the built response in-process with a short TTL, exactly as
# intersections.py/_aggregate_cache and tract_burden.py do. Each worker then
# pays the scan at most once per TTL window per (county, year), not once per
# visitor — the statement timeout alone would only convert a slow scan into a
# 503, never amortize it.
_FOG_TTL_SECONDS = 6 * 3600  # matches _AGGREGATE_TTL_SECONDS in intersections.py
_FOG_CACHE_MAX = 256
_fog_cache: dict[tuple[str | None, int | None], tuple[float, FogDaysOut]] = {}


def clear_fog_cache() -> None:
    """Drop all cached fog-days results (tests / invalidation)."""
    _fog_cache.clear()


def _cached_fog_days(db: Session, county: str | None, year: int | None) -> FogDaysOut:
    """build_fog_days wrapped in the intersections-style TTL cache.

    Keyed on the normalized inputs, so `?county=Fresno` and `?county=fresno`
    share one entry. A miss still calls build_fog_days, so an unknown slug
    raises FilterError as before rather than being cached as a result.
    """
    key = (county.strip().lower() or None if county else None, year)
    hit = _fog_cache.get(key)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]
    result = build_fog_days(db, county, year)
    if len(_fog_cache) >= _FOG_CACHE_MAX:
        _fog_cache.clear()
    _fog_cache[key] = (time.monotonic() + _FOG_TTL_SECONDS, result)
    return result


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
    apply_statement_timeout(db, 30_000)
    response.headers["Cache-Control"] = _CACHE
    return _cached_fog_days(db, county, year)
