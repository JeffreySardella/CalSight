"""Tests for the DMV vehicle registration ETL.

Tests the resource ID mapping and verifies the CKAN resource IDs
are configured for all expected years.
"""

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
