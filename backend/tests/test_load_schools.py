"""Tests for the school locations ETL.

Tests the data filtering and safe type conversion logic.
"""

from etl.load_schools import _safe_float


class TestSafeFloat:
    def test_converts_valid_float_string(self):
        assert _safe_float("37.7749") == 37.7749

    def test_converts_int(self):
        assert _safe_float(42) == 42.0

    def test_returns_none_for_none(self):
        assert _safe_float(None) is None

    def test_returns_none_for_empty_string(self):
        assert _safe_float("") is None

    def test_returns_none_for_invalid_string(self):
        assert _safe_float("not a number") is None

    def test_negative_coordinates(self):
        assert _safe_float("-122.4194") == -122.4194
