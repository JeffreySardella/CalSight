"""Pure-logic tests for the first-rain detector (no network, no DB)."""

from datetime import date, datetime, timedelta
from types import SimpleNamespace

from etl.compute_first_rain import (
    MATURITY_DAYS,
    FirstRain,
    compute_events,
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

    def test_sub_threshold_drizzle_does_not_reset_the_run(self):
        # 20 dry, 0.05" drizzle, 5 dry, 0.2": the drizzle day counts as dry -> 26 days.
        daily = _days(date(2025, 10, 1), [0.0] * 20 + [0.05] + [0.0] * 5 + [0.2])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 27), 0.2, 26)

    def test_day_just_under_threshold_before_the_storm_still_counts_as_dry(self):
        daily = _days(date(2025, 10, 1), [0.0] * 20 + [0.09, 0.5])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 22), 0.5, 21)

    def test_trace_below_0_01_does_not_reset(self):
        daily = _days(date(2025, 10, 1), [0.0] * 10 + [0.005] + [0.0] * 5 + [0.2])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 17), 0.2, 16)

    def test_dry_summer_yields_summer_length_run(self):
        # Last measurable rain May 1; a few trace/drizzle days over a dry summer;
        # 0.6" on Oct 28 -> 179 days since the last >= 0.10" day.
        summer = [0.0] * 179
        for i in (30, 75, 120):
            summer[i] = 0.04
        daily = _days(date(2025, 5, 1), [0.3] + summer + [0.6])
        assert detect_first_rain(daily, 2026) == FirstRain(date(2025, 10, 28), 0.6, 179)

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


# ── maturity gate ────────────────────────────────────────────────────────
#
# compute_events against a fake session: canned results in the order it
# issues statements (newest crash, counties with weather, all counties, one
# county's daily precip, then per-hit crash counts + upsert).

class _FakeResult:
    def __init__(self, payload):
        self._payload = payload

    def scalar(self):
        return self._payload

    def all(self):
        return self._payload

    def one(self):
        return self._payload


class _FakeDB:
    def __init__(self, *results):
        self._results = list(results)
        self.upserts = 0

    def execute(self, stmt, *args, **kwargs):
        if self._results:
            return _FakeResult(self._results.pop(0))
        self.upserts += 1  # the INSERT ... ON CONFLICT
        return _FakeResult(None)

    def commit(self):
        pass


FIRST_RAIN = date(2025, 10, 21)


def _db(newest_crash_days_after: int):
    return _FakeDB(
        datetime.combine(FIRST_RAIN + timedelta(days=newest_crash_days_after), datetime.min.time()),
        [(19,)],
        [(19,), (30,)],
        _days(date(2025, 10, 1), [0.0] * 20 + [0.4]),
        SimpleNamespace(on_day=3, before=28),
    )


def test_event_inside_maturity_window_is_deferred_not_stored():
    db = _db(10)
    assert compute_events(db, [2026]) == (0, 1, 1, 1)
    assert db.upserts == 0


def test_event_past_maturity_window_is_stored():
    db = _db(60)
    assert compute_events(db, [2026]) == (1, 1, 1, 0)
    assert db.upserts == 1


def test_maturity_boundary_is_inclusive():
    assert compute_events(_db(MATURITY_DAYS), [2026])[0] == 1
    assert compute_events(_db(MATURITY_DAYS - 1), [2026])[0] == 0


def test_no_crashes_at_all_defers_everything():
    db = _FakeDB(None, [(19,)], [(19,)], _days(date(2025, 10, 1), [0.0] * 20 + [0.4]))
    assert compute_events(db, [2026]) == (0, 1, 0, 1)
