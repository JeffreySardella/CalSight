"""Pure-logic tests for the first-rain detector (no network, no DB)."""

from datetime import date, timedelta

from etl.compute_first_rain import (
    FirstRain,
    compute_lift,
    current_water_year,
    detect_first_rain,
    water_year_bounds,
)


def _days(start: date, precips: list[float]) -> list[tuple[date, float]]:
    return [(start + timedelta(days=i), p) for i, p in enumerate(precips)]


class TestWaterYear:
    def test_bounds(self):
        assert water_year_bounds(2026) == (date(2025, 10, 1), date(2026, 9, 30))

    def test_current_water_year_rolls_on_oct_1(self):
        assert current_water_year(date(2026, 9, 30)) == 2026
        assert current_water_year(date(2026, 10, 1)) == 2027


class TestDetectFirstRain:
    def test_no_rain_returns_none(self):
        daily = _days(date(2025, 9, 1), [0.0] * 120)
        assert detect_first_rain(daily, 2026) is None

    def test_rain_on_oct_1_counts_dry_days_from_prior_water_year(self):
        # 20 dry September days (WY 2025) then 0.3" on Oct 1 (first day of WY 2026).
        daily = _days(date(2025, 9, 11), [0.0] * 20 + [0.3])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 1), 0.3, 20)

    def test_rain_before_oct_1_is_not_the_event_but_resets_the_run(self):
        # Big rain on Sep 30 (WY 2025) then 0.5" on Oct 5: only 4 dry days before it.
        daily = _days(date(2025, 9, 1), [0.0] * 29 + [1.0, 0.0, 0.0, 0.0, 0.0, 0.5])
        assert detect_first_rain(daily, 2026) is None

    def test_sub_threshold_day_resets_dry_run_without_qualifying(self):
        # 20 dry, 0.05" (>= 0.01 so it resets), 5 dry, 0.2" -> only 5 dry days.
        daily = _days(date(2025, 10, 1), [0.0] * 20 + [0.05] + [0.0] * 5 + [0.2])
        assert detect_first_rain(daily, 2026) is None
        # ...but with 14 dry days after the 0.05" the 0.2" qualifies.
        daily = _days(date(2025, 10, 1), [0.0] * 20 + [0.05] + [0.0] * 14 + [0.2])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 11, 5), 0.2, 14)

    def test_trace_below_0_01_does_not_reset(self):
        daily = _days(date(2025, 10, 1), [0.0] * 10 + [0.005] + [0.0] * 5 + [0.2])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 17), 0.2, 16)

    def test_threshold_is_inclusive(self):
        daily = _days(date(2025, 10, 1), [0.0] * 14 + [0.10])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 15), 0.10, 14)

    def test_missing_day_breaks_the_run(self):
        daily = _days(date(2025, 10, 1), [0.0] * 20)
        daily += _days(date(2025, 10, 22), [0.0] * 5 + [0.5])  # Oct 21 absent
        assert detect_first_rain(daily, 2026) is None

    def test_first_qualifying_day_wins_and_later_years_are_ignored(self):
        daily = _days(date(2025, 10, 1), [0.0] * 30 + [0.4] + [0.0] * 30 + [0.9])
        daily += _days(date(2026, 10, 1), [0.0] * 30 + [2.0])  # WY 2027
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 31), 0.4, 30)

    def test_custom_parameters(self):
        daily = _days(date(2025, 10, 1), [0.0] * 3 + [0.02])
        assert detect_first_rain(daily, 2026, threshold_in=0.02, min_dry_days=3) == FirstRain(
            date(2025, 10, 4), 0.02, 3
        )


def test_compute_lift():
    assert compute_lift(912, 640.2) == 42.5
    assert compute_lift(0, 0.0) is None
