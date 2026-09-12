"""Unit tests for the water day-of-year baseline: 1991-2020 normal when a
station-day has enough years inside it, otherwise the period of record.
Mocked session, matching the loader suites."""

from datetime import date
from unittest.mock import MagicMock

import pytest

from app.models import ReservoirDaily
from app.routers.water import (
    MIN_NORMAL_YEARS,
    NORMAL_PERIOD,
    latest_with_doy_average,
    pick_baseline,
)


class TestPickBaseline:
    def test_uses_normal_window_only_when_enough_years_inside(self):
        # 10 in-window years averaging 10; the out-of-window years (a huge
        # 2000 and a tiny 2026) must not touch the result.
        rows = [(1990, 500.0), (2026, 0.0)] + [
            (y, 10.0) for y in range(2011, 2011 + MIN_NORMAL_YEARS)
        ]
        b = pick_baseline(rows)
        assert b.avg == pytest.approx(10.0)
        assert b.years == MIN_NORMAL_YEARS
        assert b.period == "1991-2020"

    def test_falls_back_to_period_of_record_when_too_few_in_window(self):
        rows = [(y, 10.0) for y in range(2012, 2012 + MIN_NORMAL_YEARS - 1)]
        rows += [(2024, 30.0), (2026, 50.0)]
        b = pick_baseline(rows)
        assert b.avg == pytest.approx(sum(v for _, v in rows) / len(rows))
        assert b.years == len(rows)
        assert b.period == "2012-2026"

    def test_empty_rows(self):
        assert pick_baseline([]) == (None, 0, None)

    def test_normal_period_is_dwr_climatological_normal(self):
        assert NORMAL_PERIOD == (1991, 2020)


class TestLatestWithDoyAverage:
    def test_passes_baseline_period_through(self):
        db = MagicMock()
        # Latest-row query (the .join(...) chain) and the day-of-year rows
        # query (the .filter(...) chain) are distinct mock chains.
        db.query.return_value.join.return_value.all.return_value = [
            ("FOL", date(2026, 7, 1), 800_000.0),
        ]
        db.query.return_value.filter.return_value.all.return_value = [
            ("FOL", date(y, 7, 1), 600_000.0) for y in range(2005, 2021)
        ] + [("FOL", date(2026, 7, 1), 800_000.0)]

        c = latest_with_doy_average(db, ReservoirDaily, ReservoirDaily.storage_af)["FOL"]
        assert c.value == 800_000.0
        assert c.avg == pytest.approx(600_000.0)  # 2026 excluded
        assert c.years == 16
        assert c.baseline_period == "1991-2020"
        assert c.has_history
