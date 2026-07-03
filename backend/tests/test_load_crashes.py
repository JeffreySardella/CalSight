"""Tests for the crash ETL orchestrator.

Tests pure logic (source routing) without needing a database connection.
The actual DB upsert is exercised in the integration test.
"""

from etl.load_crashes import (
    determine_source,
    normalize_city_id,
    select_years_to_load,
)


class TestDetermineSource:
    def test_2001_to_2015_uses_switrs(self):
        for year in (2001, 2010, 2015):
            assert determine_source(year) == "switrs", f"Failed for {year}"

    def test_2016_onwards_uses_ccrs(self):
        for year in (2016, 2020, 2026):
            assert determine_source(year) == "ccrs", f"Failed for {year}"

    def test_boundary_2015_is_switrs(self):
        assert determine_source(2015) == "switrs"

    def test_boundary_2016_is_ccrs(self):
        assert determine_source(2016) == "ccrs"


class TestNormalizeCityId:
    LOOKUP = {
        (19, "los angeles"): 101,
        (19, "long beach"): 102,
        (30, "anaheim"): 201,
    }

    def test_exact_match_resolves(self):
        row = {"county_code": 19, "city_name": "Los Angeles"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] == 101

    def test_uppercase_and_suffix_resolve(self):
        row = {"county_code": 19, "city_name": "LONG BEACH, CA"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] == 102

    def test_wrong_county_returns_none(self):
        # "Anaheim" exists, but only in Orange (30) — should not match in LA (19).
        row = {"county_code": 19, "city_name": "Anaheim"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None

    def test_unknown_city_returns_none(self):
        row = {"county_code": 19, "city_name": "Atlantis"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None

    def test_blank_city_name_returns_none(self):
        row = {"county_code": 19, "city_name": ""}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None

    def test_missing_county_returns_none(self):
        row = {"county_code": None, "city_name": "Los Angeles"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None


class TestSelectYearsToLoad:
    """The daily job must keep re-ingesting recent years: CHP updates the
    CCRS dataset nightly, so a year with rows is not a year that's done."""

    def test_current_and_previous_year_reload_even_when_loaded(self):
        loaded = {2025: 400_000, 2026: 120_000}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", today_year=2026,
        )
        assert 2026 in ccrs
        assert 2025 in ccrs
        assert 2026 not in skipped and 2025 not in skipped

    def test_older_loaded_years_are_skipped(self):
        loaded = {y: 500_000 for y in range(2016, 2027)}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", today_year=2026,
        )
        assert ccrs == [2025, 2026]
        assert skipped == list(range(2016, 2025))

    def test_unloaded_years_always_load(self):
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, {}, source_filter="ccrs", today_year=2026,
        )
        assert ccrs == list(range(2016, 2027))
        assert skipped == []

    def test_force_reloads_everything(self):
        loaded = {y: 500_000 for y in range(2016, 2027)}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", force=True, today_year=2026,
        )
        assert ccrs == list(range(2016, 2027))
        assert skipped == []

    def test_switrs_historical_years_still_skip(self):
        loaded = {y: 300_000 for y in range(2001, 2016)}
        switrs, _, skipped = select_years_to_load(
            2001, 2015, loaded, source_filter="switrs", today_year=2026,
        )
        assert switrs == []
        assert skipped == list(range(2001, 2016))

    def test_year_rollover_shifts_refresh_window(self):
        # On Jan 1 2027 the refresh window becomes {2026, 2027}; 2025 retires.
        loaded = {2025: 400_000, 2026: 500_000}
        _, ccrs, skipped = select_years_to_load(
            2016, 2027, loaded, source_filter="ccrs", today_year=2027,
        )
        assert 2026 in ccrs and 2027 in ccrs
        assert 2025 in skipped
