"""Tests for the NOAA weather ETL.

Tests the station-level-to-county aggregation logic without
hitting the NOAA API or database.
"""

from etl.noaa_weather import aggregate_to_monthly


class TestAggregateToMonthly:
    def test_averages_across_stations(self):
        """Multiple stations in the same month should be averaged."""
        records = [
            {"date": "2022-01-01T00:00:00", "datatype": "TAVG", "value": 50.0},
            {"date": "2022-01-01T00:00:00", "datatype": "TAVG", "value": 60.0},
            {"date": "2022-01-01T00:00:00", "datatype": "PRCP", "value": 2.0},
            {"date": "2022-01-01T00:00:00", "datatype": "PRCP", "value": 4.0},
        ]

        results = aggregate_to_monthly(records)

        assert len(results) == 1
        assert results[0]["month"] == 1
        assert results[0]["avg_temp_f"] == 55.0  # (50+60)/2
        assert results[0]["precipitation_in"] == 3.0  # (2+4)/2

    def test_separates_months(self):
        """January and February data should produce 2 separate records."""
        records = [
            {"date": "2022-01-01T00:00:00", "datatype": "TAVG", "value": 45.0},
            {"date": "2022-02-01T00:00:00", "datatype": "TAVG", "value": 50.0},
        ]

        results = aggregate_to_monthly(records)

        assert len(results) == 2
        assert results[0]["month"] == 1
        assert results[0]["avg_temp_f"] == 45.0
        assert results[1]["month"] == 2
        assert results[1]["avg_temp_f"] == 50.0

    def test_handles_all_data_types(self):
        """TAVG, TMAX, TMIN, and PRCP should all be captured."""
        records = [
            {"date": "2022-06-01T00:00:00", "datatype": "TAVG", "value": 72.0},
            {"date": "2022-06-01T00:00:00", "datatype": "TMAX", "value": 90.0},
            {"date": "2022-06-01T00:00:00", "datatype": "TMIN", "value": 55.0},
            {"date": "2022-06-01T00:00:00", "datatype": "PRCP", "value": 0.1},
        ]

        results = aggregate_to_monthly(records)

        assert results[0]["avg_temp_f"] == 72.0
        assert results[0]["max_temp_f"] == 90.0
        assert results[0]["min_temp_f"] == 55.0
        assert results[0]["precipitation_in"] == 0.1

    def test_missing_data_type_returns_none(self):
        """If a datatype has no records for a month, it should be None."""
        records = [
            {"date": "2022-03-01T00:00:00", "datatype": "PRCP", "value": 1.5},
        ]

        results = aggregate_to_monthly(records)

        assert results[0]["precipitation_in"] == 1.5
        assert results[0]["avg_temp_f"] is None
        assert results[0]["max_temp_f"] is None
        assert results[0]["min_temp_f"] is None

    def test_skips_null_values(self):
        """Records with value=None should not be included in the average."""
        records = [
            {"date": "2022-01-01T00:00:00", "datatype": "TAVG", "value": 50.0},
            {"date": "2022-01-01T00:00:00", "datatype": "TAVG", "value": None},
        ]

        results = aggregate_to_monthly(records)

        assert results[0]["avg_temp_f"] == 50.0  # only the non-null value

    def test_empty_input(self):
        """No records should produce no results."""
        assert aggregate_to_monthly([]) == []

    def test_results_sorted_by_month(self):
        """Output should be in month order regardless of input order."""
        records = [
            {"date": "2022-12-01T00:00:00", "datatype": "TAVG", "value": 40.0},
            {"date": "2022-03-01T00:00:00", "datatype": "TAVG", "value": 55.0},
            {"date": "2022-07-01T00:00:00", "datatype": "TAVG", "value": 80.0},
        ]

        results = aggregate_to_monthly(records)

        months = [r["month"] for r in results]
        assert months == [3, 7, 12]
