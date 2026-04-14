"""Tests for the ETL orchestrator.

These test the pure logic (FIPS mapping, data transformation) without
needing a database connection. The actual DB upsert is tested in Task 4
when we run the real pipeline.
"""

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
        """Census API dict -> Demographic model kwargs."""
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

        assert result["county_code"] == 1
        assert result["year"] == 2022
        assert result["population"] == 1000000
        assert result["median_age"] == 35.2
        assert result["commute_wfh_pct"] == 8.75

    def test_returns_none_for_unknown_fips(self):
        """If Census returns a county we don't know about, skip it."""
        fips_lookup = {"001": 1}
        api_row = {"county_fips": "999"}

        result = transform_to_demographic_kwargs(api_row, fips_lookup, year=2022)

        assert result is None
