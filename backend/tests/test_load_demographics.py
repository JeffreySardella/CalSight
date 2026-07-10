"""Tests for the ETL orchestrator.

These test the pure logic (FIPS mapping, data transformation) without
needing a database connection, plus the run()-level failure handling
(H1). The actual DB upsert is tested in Task 4 when we run the real
pipeline.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from etl.load_demographics import build_fips_lookup, transform_to_demographic_kwargs


# Simulates rows you'd get from: SELECT code, fips FROM counties
MOCK_COUNTIES = [
    (1, "06001"),   # Alameda
    (10, "06019"),  # Fresno
    (19, "06037"),  # Los Angeles
]


class TestBuildFipsLookup:
    def test_maps_three_digit_fips_to_county_code(self):
        """Census API returns "001", our DB stores "06001".
        This lookup bridges between them."""
        lookup = build_fips_lookup(MOCK_COUNTIES)
        assert lookup["001"] == 1
        assert lookup["019"] == 10
        assert lookup["037"] == 19

    def test_ignores_counties_with_no_fips(self):
        """Some counties might not have FIPS — skip them safely."""
        counties_with_none = [(99, None)]
        lookup = build_fips_lookup(counties_with_none)
        assert len(lookup) == 0


class TestTransformToDemographicKwargs:
    def test_transforms_api_row_to_model_kwargs(self):
        """Census API dict -> Demographic model kwargs with all fields."""
        fips_lookup = {"001": 1}
        api_row = {
            "county_fips": "001",
            "population": 1000000,
            "median_age": 35.2,
            "median_income": 65000,
            "commute_drive_alone_pct": 62.5,
            "commute_carpool_pct": 10.0,
            "commute_transit_pct": 6.25,
            "commute_walk_pct": 3.75,
            "commute_bike_pct": 1.25,
            "commute_wfh_pct": 8.75,
            # New fields
            "pct_white": 40.0,
            "pct_black": 6.0,
            "pct_asian": 15.0,
            "pct_hispanic": 35.0,
            "pct_other_race": 4.0,
            "pct_under_18": 22.0,
            "pct_18_24": 10.0,
            "pct_25_44": 28.0,
            "pct_45_64": 26.0,
            "pct_65_plus": 14.0,
            "poverty_rate": 12.0,
            "pct_bachelors_or_higher": 31.0,
            "pct_high_school_or_higher": 93.0,
            "pct_no_vehicle": 7.0,
            "pct_owner_occupied_housing": 55.0,
            "pct_english_only": 60.0,
            "pct_spanish_speaking": 30.0,
        }

        result = transform_to_demographic_kwargs(api_row, fips_lookup, year=2022)

        assert result["county_code"] == 1
        assert result["year"] == 2022
        assert result["population"] == 1000000
        assert result["median_age"] == 35.2
        assert result["commute_wfh_pct"] == 8.75
        # New fields
        assert result["pct_white"] == 40.0
        assert result["pct_hispanic"] == 35.0
        assert result["pct_under_18"] == 22.0
        assert result["pct_65_plus"] == 14.0
        assert result["poverty_rate"] == 12.0
        assert result["pct_bachelors_or_higher"] == 31.0
        assert result["pct_no_vehicle"] == 7.0
        assert result["pct_owner_occupied_housing"] == 55.0
        assert result["pct_english_only"] == 60.0
        assert result["pct_spanish_speaking"] == 30.0

    def test_returns_none_for_unknown_fips(self):
        """If Census returns a county we don't know about, skip it."""
        fips_lookup = {"001": 1}
        api_row = {"county_fips": "999"}

        result = transform_to_demographic_kwargs(api_row, fips_lookup, year=2022)

        assert result is None

    def test_handles_missing_new_fields_gracefully(self):
        """Old-format API rows (without new fields) should still work."""
        fips_lookup = {"001": 1}
        api_row = {
            "county_fips": "001",
            "population": 1000000,
            "median_age": 35.2,
            "median_income": 65000,
            "commute_drive_alone_pct": 62.5,
            "commute_carpool_pct": 10.0,
            "commute_transit_pct": 6.25,
            "commute_walk_pct": 3.75,
            "commute_bike_pct": 1.25,
            "commute_wfh_pct": 8.75,
        }

        result = transform_to_demographic_kwargs(api_row, fips_lookup, year=2022)

        assert result["population"] == 1000000
        assert result["pct_white"] is None
        assert result["pct_under_18"] is None
        assert result["poverty_rate"] is None


def _patch_etl_run_tracking(monkeypatch):
    """Stub out the EtlRun bookkeeping so run() needs no database."""
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRunFailureHandling:
    def test_missing_api_key_exits_nonzero(self, monkeypatch):
        """H1 baseline: a missing CENSUS_API_KEY exits 1 (and now records
        an error EtlRun instead of stranding it in 'running')."""
        from etl import load_demographics as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "settings", SimpleNamespace(census_api_key=""))

        with pytest.raises(SystemExit) as exc_info:
            mod.run(start_year=2021, end_year=2021)
        assert exc_info.value.code == 1

    def test_failed_year_raises_but_other_years_still_load(self, monkeypatch):
        """H1: failed years must not be logged-then-swallowed — the run
        raises at the end, but the years that succeeded are committed."""
        from etl import load_demographics as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "settings", SimpleNamespace(census_api_key="fake-key"))

        db = MagicMock()
        db.execute.return_value.all.return_value = [(1, "06001")]
        db.query.return_value.filter_by.return_value.first.return_value = None
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)

        def fake_fetch(year, api_key):
            if year == 2020:
                raise RuntimeError("Census API down")
            return [{"county_fips": "001", "population": 1000}]

        monkeypatch.setattr(mod, "fetch_county_demographics", fake_fetch)

        with pytest.raises(RuntimeError, match=r"1 year\(s\) failed: \[2020\]"):
            mod.run(start_year=2020, end_year=2021)

        # 2021 was still inserted and committed despite 2020 failing.
        db.add.assert_called_once()
        assert db.commit.called
