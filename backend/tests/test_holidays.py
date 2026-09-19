"""Unit tests for the holiday date rules and the lift arithmetic.

The dates below are the real ones, looked up rather than generated, so a
regression in `nth_weekday`/`last_weekday` fails here instead of quietly
shifting a whole story by a week.
"""

from datetime import date, timedelta

import pytest

from app.holidays import (
    HOLIDAYS,
    all_holiday_days,
    baseline_days,
    labor_day,
    lift_pct,
    memorial_day,
    period_days,
    summarize,
    super_bowl,
    thanksgiving,
)

YEARS = range(2016, 2026)

THANKSGIVING = {
    2016: date(2016, 11, 24), 2017: date(2017, 11, 23), 2018: date(2018, 11, 22),
    2019: date(2019, 11, 28), 2020: date(2020, 11, 26), 2021: date(2021, 11, 25),
    2022: date(2022, 11, 24), 2023: date(2023, 11, 23), 2024: date(2024, 11, 28),
    2025: date(2025, 11, 27),
}
MEMORIAL_DAY = {
    2016: date(2016, 5, 30), 2017: date(2017, 5, 29), 2018: date(2018, 5, 28),
    2019: date(2019, 5, 27), 2020: date(2020, 5, 25), 2021: date(2021, 5, 31),
    2022: date(2022, 5, 30), 2023: date(2023, 5, 29), 2024: date(2024, 5, 27),
    2025: date(2025, 5, 26),
}
LABOR_DAY = {
    2016: date(2016, 9, 5), 2017: date(2017, 9, 4), 2018: date(2018, 9, 3),
    2019: date(2019, 9, 2), 2020: date(2020, 9, 7), 2021: date(2021, 9, 6),
    2022: date(2022, 9, 5), 2023: date(2023, 9, 4), 2024: date(2024, 9, 2),
    2025: date(2025, 9, 1),
}
SUPER_BOWL = {
    2016: date(2016, 2, 7), 2017: date(2017, 2, 5), 2018: date(2018, 2, 4),
    2019: date(2019, 2, 3), 2020: date(2020, 2, 2), 2021: date(2021, 2, 7),
    2022: date(2022, 2, 13), 2023: date(2023, 2, 12), 2024: date(2024, 2, 11),
    2025: date(2025, 2, 9),
}


@pytest.mark.parametrize("year", YEARS)
def test_anchor_dates_match_the_real_calendar(year):
    assert thanksgiving(year) == THANKSGIVING[year]
    assert memorial_day(year) == MEMORIAL_DAY[year]
    assert labor_day(year) == LABOR_DAY[year]
    assert super_bowl(year) == SUPER_BOWL[year]


@pytest.mark.parametrize("year", YEARS)
def test_anchor_weekdays(year):
    assert thanksgiving(year).weekday() == 3  # Thursday
    assert memorial_day(year).weekday() == 0  # Monday
    assert labor_day(year).weekday() == 0     # Monday
    assert super_bowl(year).weekday() == 6    # Sunday


@pytest.mark.parametrize("year", YEARS)
def test_thanksgiving_period_is_wednesday_through_sunday(year):
    days = period_days("thanksgiving", year)
    assert len(days) == 5
    assert days[0] == THANKSGIVING[year] - timedelta(days=1)
    assert days[0].weekday() == 2  # Wednesday
    assert days[-1].weekday() == 6  # Sunday
    assert THANKSGIVING[year] in days


@pytest.mark.parametrize("year", YEARS)
def test_christmas_period_runs_christmas_eve_to_new_years_day(year):
    days = period_days("christmas_new_year", year)
    assert days[0] == date(year, 12, 24)
    assert days[-1] == date(year + 1, 1, 1)
    assert len(days) == 9


@pytest.mark.parametrize("year", YEARS)
def test_memorial_and_labor_day_periods_are_friday_through_monday(year):
    for key, anchor in (("memorial_day", MEMORIAL_DAY), ("labor_day", LABOR_DAY)):
        days = period_days(key, year)
        assert len(days) == 4, key
        assert days[0].weekday() == 4, key  # Friday
        assert days[-1] == anchor[year], key


@pytest.mark.parametrize("year", YEARS)
def test_july_4_period_contains_the_fourth_and_only_adjacent_weekend_days(year):
    days = period_days("july_4", year)
    assert date(year, 7, 4) in days
    # Contiguous, and every day other than the 4th is a weekend day.
    assert days == sorted(days)
    assert (days[-1] - days[0]).days + 1 == len(days)
    assert all(d.weekday() >= 5 for d in days if d != date(year, 7, 4))
    assert 1 <= len(days) <= 3


def test_july_4_period_worked_examples():
    # 2020: Jul 4 is a Saturday -> Sat + Sun.
    assert period_days("july_4", 2020) == [date(2020, 7, 4), date(2020, 7, 5)]
    # 2021: Jul 4 is a Sunday -> Sat + Sun.
    assert period_days("july_4", 2021) == [date(2021, 7, 3), date(2021, 7, 4)]
    # 2022: Jul 4 is a Monday -> Sat, Sun, Mon.
    assert period_days("july_4", 2022) == [
        date(2022, 7, 2), date(2022, 7, 3), date(2022, 7, 4)
    ]
    # 2025: Jul 4 is a Friday -> Fri, Sat, Sun.
    assert period_days("july_4", 2025) == [
        date(2025, 7, 4), date(2025, 7, 5), date(2025, 7, 6)
    ]
    # 2023: Jul 4 is a Tuesday -> stands alone.
    assert period_days("july_4", 2023) == [date(2023, 7, 4)]


@pytest.mark.parametrize("year", YEARS)
def test_halloween_period_is_both_whole_days(year):
    assert period_days("halloween", year) == [date(year, 10, 31), date(year, 11, 1)]


@pytest.mark.parametrize("year", YEARS)
def test_super_bowl_period_is_the_single_sunday(year):
    assert period_days("super_bowl", year) == [SUPER_BOWL[year]]


def test_unknown_holiday_raises():
    with pytest.raises(ValueError):
        period_days("arbor_day", 2020)


def test_baseline_excludes_every_holiday_day_in_the_anchor_month():
    excluded = all_holiday_days(YEARS)
    november = baseline_days("thanksgiving", 2023, excluded)
    # Nov 1 belongs to Halloween night, so it is not an ordinary November day.
    assert date(2023, 11, 1) not in november
    assert date(2023, 11, 23) not in november  # Thanksgiving itself
    assert date(2023, 11, 2) in november
    # 30 days in November, minus Nov 1 and the 5 Thanksgiving days.
    assert len(november) == 24


def test_baseline_for_christmas_is_december_minus_the_period():
    excluded = all_holiday_days(YEARS)
    december = baseline_days("christmas_new_year", 2023, excluded)
    assert len(december) == 31 - 8  # Dec 24-31 are in the period
    assert december[-1] == date(2023, 12, 23)


def test_lift_pct_arithmetic():
    assert lift_pct(12.0, 10.0) == 20.0
    assert lift_pct(8.0, 10.0) == -20.0
    assert lift_pct(10.0, 10.0) == 0.0
    assert lift_pct(5.0, 0) is None  # undefined, not infinite


def _flat(value=(10, 1, 1)):
    """Every day in 2024 carries the same counts."""
    day = date(2024, 1, 1)
    out = {}
    while day <= date(2024, 12, 31):
        out[day] = value
        day += timedelta(days=1)
    return out


def test_summarize_reports_zero_lift_when_every_day_is_identical():
    rows = summarize(_flat(), [2024], (date(2024, 1, 1), date(2024, 12, 31)))
    assert {r["key"] for r in rows} == {k for k, _, _ in HOLIDAYS}
    for row in rows:
        assert row["crashes_per_day"] == 10.0
        assert row["baseline"]["crashes_per_day"] == 10.0
        assert row["crashes_lift_pct"] == 0.0
        assert row["deaths_lift_pct"] == 0.0
        assert row["dui_share_pct"] == 10.0
        assert row["dui_share_lift_pct"] == 0.0


def test_summarize_lift_arithmetic_on_a_doubled_holiday():
    daily = _flat()
    for day in period_days("thanksgiving", 2024):
        daily[day] = (30, 3, 6)  # 3x the crashes, 3x deaths, 2x the DUI share
    rows = {r["key"]: r for r in summarize(daily, [2024], (date(2024, 1, 1), date(2024, 12, 31)))}
    tg = rows["thanksgiving"]

    assert tg["days"] == 5
    assert tg["crashes"] == 150
    assert tg["killed"] == 15
    assert tg["crashes_per_day"] == 30.0
    assert tg["deaths_per_day"] == 3.0
    assert tg["dui_share_pct"] == 20.0

    # Thanksgiving 2024 is Nov 28, so the Sunday of its period is Dec 1 and
    # only 4 of its 5 days fall in November. 30 - 4 - Nov 1 (Halloween) = 25.
    assert tg["baseline"]["days"] == 25
    assert tg["baseline"]["crashes_per_day"] == 10.0

    assert tg["crashes_lift_pct"] == 200.0
    assert tg["deaths_lift_pct"] == 200.0
    assert tg["dui_share_lift_pct"] == 100.0
    # Untouched holidays are unaffected.
    assert rows["super_bowl"]["crashes_lift_pct"] == 0.0


def test_summarize_counts_days_with_no_rows_in_the_denominator():
    # Only Thanksgiving Day itself has data; the other 4 period days are
    # missing from the mapping and must still count as days.
    daily = {thanksgiving(2024): (50, 5, 5)}
    rows = {r["key"]: r for r in summarize(daily, [2024], (date(2024, 1, 1), date(2024, 12, 31)))}
    tg = rows["thanksgiving"]
    assert tg["days"] == 5
    assert tg["crashes_per_day"] == 10.0  # 50 / 5, not 50 / 1
    assert tg["baseline"]["crashes_per_day"] == 0.0
    assert tg["crashes_lift_pct"] is None  # zero baseline -> undefined


def test_summarize_clips_a_period_that_runs_past_the_window():
    # The 2024 Christmas period ends on Jan 1 2025, outside a 2024-only window.
    rows = {r["key"]: r for r in summarize(_flat(), [2024], (date(2024, 1, 1), date(2024, 12, 31)))}
    assert rows["christmas_new_year"]["days"] == 8
    assert len(period_days("christmas_new_year", 2024)) == 9


def test_small_sample_is_clear_when_the_baseline_is_thick_and_the_holiday_long():
    # 10 crashes/day everywhere, and every holiday pools >= 5 days over 10 years.
    daily = {}
    for year in range(2016, 2026):
        day = date(year, 1, 1)
        while day <= date(year, 12, 31):
            daily[day] = (10, 1, 1)
            day += timedelta(days=1)
    rows = summarize(daily, range(2016, 2026), (date(2016, 1, 1), date(2025, 12, 31)))
    assert all(r["small_sample"] is False for r in rows), [
        r["key"] for r in rows if r["small_sample"]
    ]


def test_small_sample_flags_a_thin_baseline():
    # 1 crash/day is below MIN_BASELINE_CRASHES_PER_DAY, so every lift is noisy.
    daily = _flat((1, 0, 0))
    rows = summarize(daily, [2024], (date(2024, 1, 1), date(2024, 12, 31)))
    assert all(r["small_sample"] is True for r in rows)
    # The numbers are still reported — flagged, never hidden.
    assert all(r["crashes_lift_pct"] == 0.0 for r in rows)


def test_small_sample_flags_a_short_pooled_holiday_even_on_a_thick_baseline():
    daily = _flat((100, 10, 10))
    rows = {r["key"]: r for r in summarize(daily, [2024], (date(2024, 1, 1), date(2024, 12, 31)))}
    # One year only: Super Bowl is 1 day and Halloween 2, both under the floor.
    assert rows["super_bowl"]["days"] == 1 and rows["super_bowl"]["small_sample"] is True
    assert rows["halloween"]["days"] == 2 and rows["halloween"]["small_sample"] is True
    # Thanksgiving is 5 days, right on the floor, with a thick baseline.
    assert rows["thanksgiving"]["days"] == 5 and rows["thanksgiving"]["small_sample"] is False


def test_small_sample_flags_the_endpoint_fixture_shape():
    # The integration fixture's shape: one busy holiday day against a baseline
    # of 0.2 crashes/day, which yields a +900% lift off almost nothing.
    daily = {thanksgiving(2024): (10, 2, 4), date(2024, 11, 5): (5, 1, 1)}
    rows = {r["key"]: r for r in summarize(daily, [2024], (date(2024, 1, 1), date(2024, 12, 31)))}
    tg = rows["thanksgiving"]
    assert tg["crashes_lift_pct"] == 900.0
    assert tg["small_sample"] is True


def test_summarize_pools_years():
    window = (date(2023, 1, 1), date(2025, 12, 31))
    daily = {}
    for year in (2023, 2024, 2025):
        day = date(year, 1, 1)
        while day <= date(year, 12, 31):
            daily[day] = (10, 1, 1)
            day += timedelta(days=1)
    rows = {r["key"]: r for r in summarize(daily, [2023, 2024, 2025], window)}
    # Super Bowl Sunday: one day per year, three years.
    assert rows["super_bowl"]["days"] == 3
    assert rows["super_bowl"]["crashes"] == 30
