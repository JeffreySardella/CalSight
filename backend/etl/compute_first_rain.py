"""First-rain crash analysis — per county, per water year.

California summers are dry; the first measurable rain of the water year
(Oct 1–Sep 30) lands on roads coated with months of oil and dust. This job
finds that day for every county from `weather_daily`, counts crashes on it,
and compares against the mean daily crash count over the 28 calendar days
before it. Results land in `first_rain_events` (one row per county × water
year) and are served by /api/first-rain.

Rule: the first day in the water year with precip >= THRESHOLD_IN whose
preceding consecutive run of dry days (precip < DRY_MAX_IN, counted back
across the Oct 1 boundary; a missing day breaks the run) is >= MIN_DRY_DAYS.
A day with DRY_MAX_IN <= precip < THRESHOLD_IN resets the run without
qualifying.

Backfill order after deploy (weather_daily starts empty):
    python -m etl.nclimgrid_weather --start 2001-01 --end <current YYYY-MM>
    python -m etl.compute_first_rain --all

Usage:
    python -m etl.compute_first_rain          # current + previous water year
    python -m etl.compute_first_rain --all    # every water year from 2002
"""

import argparse
import logging
from datetime import date, timedelta
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal
from app.models import County, Crash, FirstRainEvent, WeatherDaily
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

THRESHOLD_IN = 0.10   # first "measurable" rain
DRY_MAX_IN = 0.01     # below this a day counts as dry
MIN_DRY_DAYS = 14
BASELINE_DAYS = 28
FIRST_WATER_YEAR = 2002  # crashes start 2001, so WY 2002 is the first with a full baseline


class FirstRain(NamedTuple):
    first_rain_date: date
    precip_in: float
    dry_days_before: int


def water_year_bounds(water_year: int) -> tuple[date, date]:
    return date(water_year - 1, 10, 1), date(water_year, 9, 30)


def current_water_year(today: date | None = None) -> int:
    today = today or date.today()
    return today.year + 1 if today.month >= 10 else today.year


def detect_first_rain(
    daily: list[tuple[date, float]],
    water_year: int,
    threshold_in: float = THRESHOLD_IN,
    min_dry_days: int = MIN_DRY_DAYS,
) -> FirstRain | None:
    """First qualifying rain day of `water_year`, or None.

    `daily` is (date, precip_in) sorted ascending; it may extend before and
    after the water year (the dry run counts back into the prior year).
    """
    start, end = water_year_bounds(water_year)
    dry_run = 0
    prev: date | None = None
    for d, precip in daily:
        if d > end:
            break
        if prev is not None and (d - prev).days != 1:
            dry_run = 0  # a gap in the record breaks the run
        if d >= start and precip >= threshold_in and dry_run >= min_dry_days:
            return FirstRain(d, precip, dry_run)
        dry_run = dry_run + 1 if precip < DRY_MAX_IN else 0
        prev = d
    return None


def compute_lift(crashes_on_day: int, baseline: float) -> float | None:
    if baseline == 0:
        return None
    return round((crashes_on_day - baseline) / baseline * 100, 1)


def _crash_counts(db, county_code: int, day: date) -> tuple[int, float]:
    """(crashes on `day`, mean daily crashes over the BASELINE_DAYS before it)."""
    window_start = day - timedelta(days=BASELINE_DAYS)
    on_day = Crash.crash_datetime >= day
    row = db.execute(
        select(
            func.count().filter(on_day).label("on_day"),
            func.count().filter(~on_day).label("before"),
        ).where(
            Crash.county_code == county_code,
            Crash.crash_datetime >= window_start,
            Crash.crash_datetime < day + timedelta(days=1),
        )
    ).one()
    return int(row.on_day), row.before / BASELINE_DAYS


def compute_events(db, water_years: list[int]) -> tuple[int, int, int]:
    """Detect + upsert first-rain events. Returns (events, counties, skipped_no_weather)."""
    codes_with_weather = [
        c for (c,) in db.execute(select(WeatherDaily.county_code).distinct()).all()
    ]
    all_codes = [c for (c,) in db.execute(select(County.code)).all()]
    events = 0
    for code in codes_with_weather:
        daily = db.execute(
            select(WeatherDaily.date, WeatherDaily.precip_in)
            .where(WeatherDaily.county_code == code, WeatherDaily.precip_in.isnot(None))
            .order_by(WeatherDaily.date)
        ).all()
        daily = [(d, p) for d, p in daily]
        for wy in water_years:
            hit = detect_first_rain(daily, wy)
            if hit is None:
                continue
            on_day, baseline = _crash_counts(db, code, hit.first_rain_date)
            stmt = pg_insert(FirstRainEvent).values(
                county_code=code,
                water_year=wy,
                first_rain_date=hit.first_rain_date,
                precip_in=hit.precip_in,
                dry_days_before=hit.dry_days_before,
                crashes_on_day=on_day,
                baseline_daily_crashes=round(baseline, 2),
                baseline_days=BASELINE_DAYS,
                lift_pct=compute_lift(on_day, baseline),
                computed_at=func.now(),
            )
            db.execute(stmt.on_conflict_do_update(
                constraint="first_rain_events_county_code_water_year_key",
                set_={k: getattr(stmt.excluded, k) for k in (
                    "first_rain_date", "precip_in", "dry_days_before", "crashes_on_day",
                    "baseline_daily_crashes", "baseline_days", "lift_pct", "computed_at",
                )},
            ))
            events += 1
        db.commit()
    return events, len(codes_with_weather), len(all_codes) - len(codes_with_weather)


@track_etl_run("first_rain")
def run(all_years: bool = False) -> int:
    this_wy = current_water_year()
    water_years = list(range(FIRST_WATER_YEAR, this_wy + 1)) if all_years else [this_wy - 1, this_wy]
    db = SessionLocal()
    try:
        events, counties, skipped = compute_events(db, water_years)
        logger.info(
            "first_rain: %d events computed across %d counties for WY %d-%d; "
            "%d counties skipped (no weather_daily data)",
            events, counties, water_years[0], water_years[-1], skipped,
        )
        return events
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute first-rain crash events")
    parser.add_argument("--all", action="store_true", help=f"every water year from {FIRST_WATER_YEAR}")
    args = parser.parse_args()
    run(all_years=args.all)
