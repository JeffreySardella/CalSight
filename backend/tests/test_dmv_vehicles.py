"""Tests for the DMV vehicle registration ETL.

Tests the resource ID mapping, verifies the CKAN resource IDs are
configured for all expected years, and covers the run()-level
failure handling (H1).
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from etl.dmv_vehicles import RESOURCE_IDS, DEFAULT_START_YEAR, DEFAULT_END_YEAR


class TestResourceIds:
    def test_all_default_years_have_resource_ids(self):
        """Every year in the default range should have a CKAN resource ID."""
        for year in range(DEFAULT_START_YEAR, DEFAULT_END_YEAR + 1):
            assert year in RESOURCE_IDS, f"Missing resource ID for {year}"

    def test_resource_ids_are_non_empty_strings(self):
        """Each resource ID should be a valid UUID-like string."""
        for year, rid in RESOURCE_IDS.items():
            assert isinstance(rid, str), f"Year {year}: expected string"
            assert len(rid) > 10, f"Year {year}: resource ID too short"

    def test_no_duplicate_resource_ids(self):
        """Each year should map to a unique resource ID."""
        ids = list(RESOURCE_IDS.values())
        assert len(ids) == len(set(ids)), "Duplicate resource IDs found"


def _patch_etl_run_tracking(monkeypatch):
    """Stub out the EtlRun bookkeeping so run() needs no database."""
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRunFailureHandling:
    def test_missing_crosswalk_raises(self, monkeypatch):
        """H1: a failed crosswalk download must abort with an error, not
        return quietly (exit 0 recorded success while loading nothing)."""
        from etl import dmv_vehicles as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "build_zip_to_county_mapping", lambda: {})

        with pytest.raises(RuntimeError, match="crosswalk unavailable"):
            mod.run(start_year=2020, end_year=2020)

    def test_failed_year_raises_but_other_years_still_load(self, monkeypatch):
        """H1: a per-year fetch failure must not be swallowed — the run
        raises at the end, but the years that succeeded are committed."""
        from etl import dmv_vehicles as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(
            mod, "build_zip_to_county_mapping", lambda: {"94601": 1}
        )

        db = MagicMock()
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)

        def fake_fetch(year, zip_to_county):
            if year == 2020:
                raise RuntimeError("CKAN 503")
            return {1: {"total_vehicles": 100, "ev_vehicles": 10}}

        monkeypatch.setattr(mod, "fetch_and_aggregate_year", fake_fetch)

        with pytest.raises(RuntimeError, match=r"1 year\(s\) failed: \[2020\]"):
            mod.run(start_year=2020, end_year=2021)

        # 2021 was still upserted and committed despite 2020 failing.
        assert db.execute.called
        assert db.commit.called
