"""Tests for the hospital locations ETL.

Tests the facility type filtering and safe type conversions.
"""

from etl.load_hospitals import HOSPITAL_TYPES, _safe_float, _safe_int


class TestHospitalTypes:
    def test_includes_general_acute_care(self):
        assert "GENERAL ACUTE CARE HOSPITAL" in HOSPITAL_TYPES

    def test_includes_childrens_hospital(self):
        assert "ACUTE CARE CHILDREN'S HOSPITAL" in HOSPITAL_TYPES

    def test_excludes_nursing_facilities(self):
        """Nursing homes should not be included in hospital data."""
        assert "SKILLED NURSING FACILITY" not in HOSPITAL_TYPES
        assert "INTERMEDIATE CARE FACILITY" not in HOSPITAL_TYPES

    def test_excludes_clinics(self):
        assert "CLINIC" not in HOSPITAL_TYPES


class TestSafeFloat:
    def test_valid_float(self):
        assert _safe_float("38.256") == 38.256

    def test_none(self):
        assert _safe_float(None) is None

    def test_empty_string(self):
        assert _safe_float("") is None

    def test_invalid(self):
        assert _safe_float("N/A") is None


class TestSafeInt:
    def test_valid_int(self):
        assert _safe_int("99") == 99

    def test_none(self):
        assert _safe_int(None) is None

    def test_empty_string(self):
        assert _safe_int("") is None

    def test_float_value(self):
        assert _safe_int(99.0) == 99

    def test_invalid(self):
        assert _safe_int("N/A") is None
