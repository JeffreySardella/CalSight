"""Tests for the hospital locations ETL.

Tests the facility type filtering and safe type conversions, plus the
zero-row guard on run(): an empty/malformed CKAN response must fail the
job instead of recording a silent zero-row "success".
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

from etl.load_hospitals import HOSPITAL_TYPES, _safe_float, _safe_int


def _ckan_response(records: list[dict], total: int | None = None) -> httpx.Response:
    import json

    body = {"result": {"total": total if total is not None else len(records), "records": records}}
    return httpx.Response(
        status_code=200,
        content=json.dumps(body).encode(),
        request=httpx.Request("GET", "https://data.ca.gov"),
    )


def _empty_response() -> httpx.Response:
    # A well-formed 200 with a genuinely empty CKAN result — the case that
    # used to silently record "0 hospitals upserted" as a success.
    return httpx.Response(
        status_code=200,
        content=b'{"result": {"total": 0, "records": []}}',
        request=httpx.Request("GET", "https://data.ca.gov"),
    )


def _patch_etl_run_tracking(monkeypatch):
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRunZeroRowGuard:
    def _db(self):
        db = MagicMock()
        db.query.return_value.all.return_value = [("Alameda", 1)]
        return db

    def test_empty_response_raises(self, monkeypatch):
        from etl import load_hospitals as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "SessionLocal", lambda: self._db())
        monkeypatch.setattr(
            mod, "get_with_retry", lambda *a, **k: _empty_response()
        )

        with pytest.raises(RuntimeError, match="hospitals.*0 hospital records"):
            mod.run()

    def test_valid_fixture_still_loads(self, monkeypatch):
        from etl import load_hospitals as mod

        _patch_etl_run_tracking(monkeypatch)
        db = self._db()
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)

        record = {
            "FAC_FDR": "GENERAL ACUTE CARE HOSPITAL",
            "FAC_STATUS_TYPE_CODE": "OPEN",
            "COUNTY_NAME": "ALAMEDA",
            "FACID": "106010735",
            "FACNAME": "Test Hospital",
            "CITY": "Oakland",
            "ADDRESS": "123 Main St",
            "LATITUDE": "37.8",
            "LONGITUDE": "-122.27",
            "CAPACITY": "200",
            "TRAUMA_CTR": None,
            "TRAUMA_PED_CTR": None,
        }
        monkeypatch.setattr(
            mod, "get_with_retry", lambda *a, **k: _ckan_response([record])
        )

        mod.run()  # must not raise

        assert db.execute.called
        assert db.commit.called


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
