"""GET /api/first-rain — crashes on the first rainy day of each water year.

Serves the rows etl/compute_first_rain.py precomputes into first_rain_events
(per county × water year) plus a statewide roll-up and a "days since rain"
strip from weather_daily. The only live crash query is the per-day series,
which is bounded to one county and a 29-day window on the
(county_code, crash_datetime) index.

Small-number discipline: a county whose 28-day baseline averages fewer than
_MIN_BASELINE crashes/day gets `small_baseline` — its lift is reported, never
hidden, but the frontend shouldn't headline it.
"""

from __future__ import annotations

from datetime import timedelta
from statistics import median, median_low

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from slowapi import Limiter
from sqlalchemy import cast, func, select
from sqlalchemy.orm import Session
from sqlalchemy.types import Date

from app.county_slug_map import get_slug_map, slugify_name
from app.database import apply_statement_timeout, get_db
from app.filters import parse_county_codes
from app.models import County, Crash, FirstRainEvent, WeatherDaily
from app.rate_limit import rate_limit_key
from app.schemas.first_rain import (
    CountyEvent,
    DaysSinceRain,
    FirstRainOut,
    FirstRainSeriesOut,
    SeriesPoint,
    Statewide,
    StatewideWaterYear,
)
from etl.compute_first_rain import (
    BASELINE_DAYS,
    DRY_MAX_IN,
    MIN_DRY_DAYS,
    THRESHOLD_IN,
    compute_lift,
)

router = APIRouter(tags=["first-rain"])

_limiter = Limiter(key_func=rate_limit_key)

_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
_MIN_BASELINE = 5.0  # crashes/day; below this a lift percentage is noise-prone
_SERIES_HALF_WINDOW = 14  # days either side of the first rain


@router.get("/first-rain", response_model=FirstRainOut)
@_limiter.limit("120/minute;5000/hour")
def get_first_rain(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Statewide + per-county first-rain crash lift, and days since last rain."""
    apply_statement_timeout(db, 30_000)
    response.headers["Cache-Control"] = _CACHE

    weather_through = db.execute(select(func.max(WeatherDaily.date))).scalar()

    events = db.execute(
        select(FirstRainEvent, County.name)
        .join(County, County.code == FirstRainEvent.county_code)
        .order_by(FirstRainEvent.water_year, FirstRainEvent.county_code)
    ).all()

    by_wy: dict[int, list[FirstRainEvent]] = {}
    latest: dict[int, tuple[FirstRainEvent, str]] = {}  # ordered by WY, so last write wins
    for ev, name in events:
        by_wy.setdefault(ev.water_year, []).append(ev)
        latest[ev.county_code] = (ev, name)

    statewide_events = []
    for wy, rows in by_wy.items():
        crashes = sum(r.crashes_on_day for r in rows)
        baseline = round(sum(r.baseline_daily_crashes for r in rows), 2)
        statewide_events.append(StatewideWaterYear(
            water_year=wy,
            counties=len(rows),
            crashes_on_first_rain_days=crashes,
            baseline_expected=baseline,
            lift_pct=compute_lift(crashes, baseline),
            median_first_rain_date=median_low(r.first_rain_date for r in rows),
        ))
    lifts = [e.lift_pct for e in statewide_events if e.lift_pct is not None]

    counties = [
        CountyEvent(
            county_code=ev.county_code,
            county_name=name,
            county_slug=slugify_name(name),
            water_year=ev.water_year,
            first_rain_date=ev.first_rain_date,
            precip_in=ev.precip_in,
            dry_days_before=ev.dry_days_before,
            crashes_on_day=ev.crashes_on_day,
            baseline_daily_crashes=ev.baseline_daily_crashes,
            lift_pct=ev.lift_pct,
            small_baseline=ev.baseline_daily_crashes < _MIN_BASELINE,
        )
        for ev, name in sorted(latest.values(), key=lambda t: t[0].county_code)
    ]

    last_rain = dict(db.execute(
        select(WeatherDaily.county_code, func.max(WeatherDaily.date))
        .where(WeatherDaily.precip_in >= DRY_MAX_IN)
        .group_by(WeatherDaily.county_code)
    ).all())
    days_since_rain = [
        DaysSinceRain(
            county_code=code,
            county_name=name,
            county_slug=slugify_name(name),
            last_rain_date=last_rain.get(code),
            days=(weather_through - last_rain[code]).days if code in last_rain else None,
        )
        for code, name in db.execute(select(County.code, County.name).order_by(County.code)).all()
    ]

    return FirstRainOut(
        threshold_in=THRESHOLD_IN,
        min_dry_days=MIN_DRY_DAYS,
        baseline_days=BASELINE_DAYS,
        weather_through=weather_through,
        statewide=Statewide(
            water_years=len(statewide_events),
            median_lift_pct=round(median(lifts), 1) if lifts else None,
            events=statewide_events,
        ),
        counties=counties,
        days_since_rain=days_since_rain,
    )


@router.get("/first-rain/series", response_model=FirstRainSeriesOut)
@_limiter.limit("120/minute;5000/hour")
def get_first_rain_series(
    request: Request,
    response: Response,
    county: str = Query(..., description="County slug, e.g. los-angeles"),
    water_year: int = Query(..., ge=2002, le=2100),
    db: Session = Depends(get_db),
):
    """Daily crashes and precip for the 14 days either side of a county's first rain."""
    apply_statement_timeout(db, 30_000)
    response.headers["Cache-Control"] = _CACHE

    (code,) = parse_county_codes(county, get_slug_map(db))
    row = db.execute(
        select(FirstRainEvent, County.name)
        .join(County, County.code == FirstRainEvent.county_code)
        .where(FirstRainEvent.county_code == code, FirstRainEvent.water_year == water_year)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No first-rain event for that county and water year")
    ev, name = row

    start = ev.first_rain_date - timedelta(days=_SERIES_HALF_WINDOW)
    end = ev.first_rain_date + timedelta(days=_SERIES_HALF_WINDOW)

    day = cast(Crash.crash_datetime, Date)
    crashes = dict(db.execute(
        select(day, func.count())
        .where(
            Crash.county_code == code,
            Crash.crash_datetime >= start,
            Crash.crash_datetime < end + timedelta(days=1),
        )
        .group_by(day)
    ).all())
    precip = dict(db.execute(
        select(WeatherDaily.date, WeatherDaily.precip_in)
        .where(WeatherDaily.county_code == code, WeatherDaily.date.between(start, end))
    ).all())

    points = [
        SeriesPoint(
            date=d,
            crashes=crashes.get(d, 0),
            precip_in=precip.get(d),
            is_first_rain=d == ev.first_rain_date,
        )
        for d in (start + timedelta(days=i) for i in range(2 * _SERIES_HALF_WINDOW + 1))
    ]
    return FirstRainSeriesOut(
        county_code=code,
        county_name=name,
        water_year=water_year,
        first_rain_date=ev.first_rain_date,
        points=points,
    )
