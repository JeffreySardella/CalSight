"""Tests for the speed limits ETL.

Tests the safe type conversion used for parsing HPMS data.
"""

from etl.load_speed_limits import _safe_int


class TestSafeInt:
    def test_valid_int(self):
        assert _safe_int(65) == 65

    def test_valid_string(self):
        assert _safe_int("45") == 45

    def test_none(self):
        assert _safe_int(None) is None

    def test_float_truncates(self):
        assert _safe_int(55.9) == 55

    def test_invalid(self):
        assert _safe_int("unknown") is None
