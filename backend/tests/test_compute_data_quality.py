"""Tests for the data quality stats computation."""

from etl.compute_data_quality import _safe_pct


class TestSafePct:
    def test_normal_percentage(self):
        assert _safe_pct(75, 100) == 75.0

    def test_rounds_to_one_decimal(self):
        assert _safe_pct(1, 3) == 33.3

    def test_zero_denominator_returns_none(self):
        assert _safe_pct(5, 0) is None

    def test_none_denominator_returns_none(self):
        assert _safe_pct(5, None) is None

    def test_zero_numerator(self):
        assert _safe_pct(0, 100) == 0.0

    def test_hundred_percent(self):
        assert _safe_pct(500, 500) == 100.0
