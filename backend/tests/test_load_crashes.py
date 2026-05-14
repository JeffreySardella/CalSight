"""Tests for the crash ETL orchestrator.

Tests pure logic (source routing) without needing a database connection.
The actual DB upsert is exercised in the integration test.
"""

from etl.load_crashes import determine_source, normalize_city_id


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
