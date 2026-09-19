"""Holiday period date rules and the holiday-vs-ordinary-day arithmetic.

Pure functions only — no database, no FastAPI. `app/routers/holidays.py`
fetches one row per day out of `mv_crashes_by_day` and hands the mapping to
`summarize()`, so every date rule and every division below is unit-testable
without Postgres (see `tests/test_holidays.py`).

Two rules worth stating up front, because they decide what the numbers mean:

* **The baseline is the anchor month.** Each holiday has one anchor month
  (Thanksgiving -> November, Super Bowl -> February, ...). Its baseline is
  every *other* day of that same month in that same year — days that belong
  to any holiday period are removed, so Halloween night does not sit inside
  Thanksgiving's baseline. Same month, same year, same weather, same daylight:
  the comparison isolates the holiday rather than the season.
* **Every rate is per day.** Periods have different lengths, and a period that
  runs past the end of the requested window is clipped (the 2025 Christmas
  period stops at Dec 31 rather than reaching into an incomplete 2026). Per-day
  normalisation makes a clipped period comparable to a whole one.
"""

from __future__ import annotations

import calendar
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, timedelta

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)
_WEEKEND = (SAT, SUN)
_DAY = timedelta(days=1)

# Ordered as they appear in the story. Each entry carries the anchor month
# whose ordinary days form the baseline, plus the label and the caveat the
# frontend renders verbatim (no figures live in the frontend copy).
HOLIDAYS: tuple[tuple[str, str, int], ...] = (
    ("thanksgiving", "Thanksgiving (Wed-Sun)", 11),
    ("christmas_new_year", "Christmas Eve to New Year's Day", 12),
    ("july_4", "July 4th weekend", 7),
    ("memorial_day", "Memorial Day weekend", 5),
    ("labor_day", "Labor Day weekend", 9),
    ("super_bowl", "Super Bowl Sunday", 2),
    ("halloween", "Halloween night", 10),
)

ANCHOR_MONTH: dict[str, int] = {key: month for key, _, month in HOLIDAYS}
LABEL: dict[str, str] = {key: label for key, label, _ in HOLIDAYS}


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The `n`-th `weekday` of a month, 1-based (n=1 -> the first one)."""
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def last_weekday(year: int, month: int, weekday: int) -> date:
    """The last `weekday` of a month."""
    last = date(year, month, calendar.monthrange(year, month)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def thanksgiving(year: int) -> date:
    """Fourth Thursday of November."""
    return nth_weekday(year, 11, THU, 4)


def memorial_day(year: int) -> date:
    """Last Monday of May."""
    return last_weekday(year, 5, MON)


def labor_day(year: int) -> date:
    """First Monday of September."""
    return nth_weekday(year, 9, MON, 1)


def super_bowl(year: int) -> date:
    """Super Bowl Sunday.

    The NFL moved to a 17-game regular season in 2021, pushing the game a week
    later: 2016-2021 it is the first Sunday of February, 2022 onward the
    second. Verified against the real dates for every year 2016-2025.
    """
    return nth_weekday(year, 2, SUN, 2 if year >= 2022 else 1)


def _span(start: date, end: date) -> list[date]:
    """Every day from `start` through `end`, inclusive."""
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _july_4_span(year: int) -> tuple[date, date]:
    """July 4 plus any weekend days that directly adjoin it.

    One rule covering every weekday July 4 can land on: a Monday the 4th pulls
    in the Saturday and Sunday before it, a Friday the 4th pulls in the
    Saturday and Sunday after, and a midweek the 4th stands alone.
    """
    start = end = date(year, 7, 4)
    while (start - _DAY).weekday() in _WEEKEND:
        start -= _DAY
    while (end + _DAY).weekday() in _WEEKEND:
        end += _DAY
    return start, end


def period_days(key: str, year: int) -> list[date]:
    """Every calendar day in one holiday period, ascending.

    `year` is the year the holiday itself falls in; the Christmas period runs
    into January of `year + 1`.
    """
    if key == "thanksgiving":
        day = thanksgiving(year)
        return _span(day - _DAY, day + timedelta(days=3))  # Wed through Sun
    if key == "christmas_new_year":
        return _span(date(year, 12, 24), date(year + 1, 1, 1))
    if key == "july_4":
        return _span(*_july_4_span(year))
    if key == "memorial_day":
        day = memorial_day(year)
        return _span(day - timedelta(days=3), day)  # Fri through Mon
    if key == "labor_day":
        day = labor_day(year)
        return _span(day - timedelta(days=3), day)  # Fri through Mon
    if key == "super_bowl":
        return [super_bowl(year)]
    if key == "halloween":
        # Halloween night is 6 PM Oct 31 to 6 AM Nov 1, but the source is
        # daily, so both whole days are counted. See the story's caveat.
        return _span(date(year, 10, 31), date(year, 11, 1))
    raise ValueError(f"unknown holiday {key!r}")


def all_holiday_days(years: Iterable[int]) -> set[date]:
    """Every day belonging to any holiday period in any of `years`.

    Used to carve the holidays out of each other's baselines: Nov 1 is part of
    Halloween, so it must not count as an ordinary November day when
    Thanksgiving is measured.
    """
    return {
        day
        for year in years
        for key, _, _ in HOLIDAYS
        for day in period_days(key, year)
    }


def baseline_days(key: str, year: int, excluded: set[date]) -> list[date]:
    """Ordinary days of the holiday's anchor month — the whole month minus
    every day that belongs to a holiday period."""
    month = ANCHOR_MONTH[key]
    last = calendar.monthrange(year, month)[1]
    return [
        d
        for d in (date(year, month, i) for i in range(1, last + 1))
        if d not in excluded
    ]


def lift_pct(holiday: float, ordinary: float) -> float | None:
    """Percent difference of a holiday rate against its baseline rate.

    None when the baseline is zero — an undefined lift is reported as missing,
    never as 0 or as an arbitrary large number.
    """
    if ordinary == 0:
        return None
    return round((holiday - ordinary) / ordinary * 100, 1)


def _per_day(total: int, days: int) -> float:
    return round(total / days, 3) if days else 0.0


def _share_pct(part: int, whole: int) -> float:
    return round(part / whole * 100, 2) if whole else 0.0


def _totals(
    days: Sequence[date], daily: Mapping[date, tuple[int, int, int]]
) -> dict[str, float | int]:
    """Roll a list of calendar days up into counts and per-day rates.

    A day with no row in `daily` contributes zero crashes but still counts
    toward the denominator — otherwise a quiet day would silently raise the
    average.
    """
    crashes = killed = dui = 0
    for day in days:
        c, k, d = daily.get(day, (0, 0, 0))
        crashes += c
        killed += k
        dui += d
    return {
        "days": len(days),
        "crashes": crashes,
        "killed": killed,
        "dui_crashes": dui,
        "crashes_per_day": _per_day(crashes, len(days)),
        "deaths_per_day": _per_day(killed, len(days)),
        "dui_share_pct": _share_pct(dui, crashes),
    }


def summarize(
    daily: Mapping[date, tuple[int, int, int]],
    years: Sequence[int],
    window: tuple[date, date],
) -> list[dict]:
    """One summary row per holiday, pooled across `years`.

    `daily` maps a calendar day to (crashes, killed, dui_crashes). `window`
    clips both the holiday days and the baseline days, so a period running past
    the end of the requested years contributes only the days inside it.
    """
    start, end = window
    excluded = all_holiday_days(years)

    def clip(days: Iterable[date]) -> list[date]:
        return [d for d in days if start <= d <= end]

    out: list[dict] = []
    for key, label, month in HOLIDAYS:
        holiday: list[date] = []
        ordinary: list[date] = []
        for year in years:
            holiday += clip(period_days(key, year))
            ordinary += clip(baseline_days(key, year, excluded))
        h = _totals(holiday, daily)
        b = _totals(ordinary, daily)
        out.append({
            "key": key,
            "label": label,
            "baseline_month": calendar.month_name[month],
            **h,
            "baseline": b,
            "crashes_lift_pct": lift_pct(h["crashes_per_day"], b["crashes_per_day"]),
            "deaths_lift_pct": lift_pct(h["deaths_per_day"], b["deaths_per_day"]),
            "dui_share_lift_pct": lift_pct(h["dui_share_pct"], b["dui_share_pct"]),
        })
    return out
