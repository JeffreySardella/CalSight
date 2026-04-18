"""Tests for the licensed drivers ETL."""

from etl.load_licensed_drivers import transform_wide_to_long, SKIP_ROWS


class TestTransformWideToLong:
    def test_pivots_year_columns_to_rows(self):
        records = [
            {"_id": 1, "COUNTIES": "ALAMEDA", "2022": 1100000, "2023": 1150000},
        ]
        name_to_code = {"ALAMEDA": 1}

        rows = transform_wide_to_long(records, name_to_code)

        assert len(rows) == 2
        assert rows[0] == {"county_code": 1, "year": 2022, "driver_count": 1100000}
        assert rows[1] == {"county_code": 1, "year": 2023, "driver_count": 1150000}

    def test_strips_whitespace_from_county_names(self):
        """DMV data has trailing whitespace on county names."""
        records = [
            {"_id": 1, "COUNTIES": "ALPINE  ", "2024": 800},
        ]
        name_to_code = {"ALPINE": 2}

        rows = transform_wide_to_long(records, name_to_code)
        assert len(rows) == 1
        assert rows[0]["county_code"] == 2

    def test_skips_summary_rows(self):
        records = [
            {"_id": 1, "COUNTIES": "TOTAL", "2024": 28000000},
            {"_id": 2, "COUNTIES": "OUT OF STATE", "2024": 5000},
            {"_id": 3, "COUNTIES": "ID CARDS OUTSTANDING", "2024": 1000},
        ]
        name_to_code = {"TOTAL": 99}

        rows = transform_wide_to_long(records, name_to_code)
        assert len(rows) == 0

    def test_skips_unknown_counties(self):
        records = [
            {"_id": 1, "COUNTIES": "NARNIA", "2024": 100},
        ]
        name_to_code = {"ALAMEDA": 1}

        rows = transform_wide_to_long(records, name_to_code)
        assert len(rows) == 0

    def test_handles_null_values(self):
        records = [
            {"_id": 1, "COUNTIES": "ALAMEDA", "2024": None, "2023": 1100000},
        ]
        name_to_code = {"ALAMEDA": 1}

        rows = transform_wide_to_long(records, name_to_code)
        assert len(rows) == 1
        assert rows[0]["year"] == 2023


class TestSkipRows:
    def test_skip_rows_defined(self):
        assert "TOTAL" in SKIP_ROWS
        assert "OUT OF STATE" in SKIP_ROWS
        assert "ID CARDS OUTSTANDING" in SKIP_ROWS
