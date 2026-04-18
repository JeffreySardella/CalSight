"""Tests for the road miles ETL."""

from etl.load_road_miles import METERS_PER_MILE, RESOURCE_ID


class TestConstants:
    def test_meters_per_mile(self):
        assert METERS_PER_MILE == 1609.344

    def test_resource_id_is_set(self):
        assert len(RESOURCE_ID) > 0

    def test_aggregate_sql_references_resource(self):
        """The SQL query should reference the correct resource ID."""
        from etl.load_road_miles import AGGREGATE_SQL
        assert RESOURCE_ID in AGGREGATE_SQL

    def test_aggregate_sql_groups_by_county_and_fsystem(self):
        from etl.load_road_miles import AGGREGATE_SQL
        assert "County_label" in AGGREGATE_SQL
        assert "F_System" in AGGREGATE_SQL
        assert "GROUP BY" in AGGREGATE_SQL
