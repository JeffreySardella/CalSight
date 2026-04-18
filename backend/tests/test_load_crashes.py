"""Tests for the crash ETL orchestrator.

Tests pure logic (source routing) without needing a database connection.
The actual DB upsert is exercised in the integration test.
"""

from etl.load_crashes import determine_source


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
