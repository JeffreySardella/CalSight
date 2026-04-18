"""Tests for the Caltrans AADT ETL.

Tests the county abbreviation mapping and aggregation logic
without hitting the real API or database.
"""

from etl.caltrans_aadt import CALTRANS_ABBREV_TO_NAME, aggregate_by_county


MOCK_NAME_TO_CODE = {
    "Los Angeles": 19,
    "Alameda": 1,
    "San Diego": 37,
}


class TestCaltransAbbrevMapping:
    def test_all_58_counties_mapped(self):
        """Every California county should have an abbreviation mapping."""
        assert len(CALTRANS_ABBREV_TO_NAME) == 58

    def test_common_abbreviations(self):
        assert CALTRANS_ABBREV_TO_NAME["LA"] == "Los Angeles"
        assert CALTRANS_ABBREV_TO_NAME["SD"] == "San Diego"
        assert CALTRANS_ABBREV_TO_NAME["SF"] == "San Francisco"
        assert CALTRANS_ABBREV_TO_NAME["ALA"] == "Alameda"

    def test_two_letter_codes(self):
        """Some counties use 2-letter codes instead of 3."""
        two_letter = [k for k in CALTRANS_ABBREV_TO_NAME if len(k) == 2]
        assert len(two_letter) > 0
        for code in two_letter:
            assert CALTRANS_ABBREV_TO_NAME[code]  # maps to a non-empty name


class TestAggregateByCounty:
    def test_sums_aadt_per_county(self):
        """Multiple segments in the same county should be summed."""
        segments = [
            {"CNTY": "LA", "AHEAD_AADT": 50000},
            {"CNTY": "LA", "AHEAD_AADT": 30000},
            {"CNTY": "ALA", "AHEAD_AADT": 10000},
        ]

        results = aggregate_by_county(segments, MOCK_NAME_TO_CODE)

        la = next(r for r in results if r["county_code"] == 19)
        assert la["total_aadt"] == 80000
        assert la["segment_count"] == 2
        assert la["avg_aadt_per_segment"] == 40000

        ala = next(r for r in results if r["county_code"] == 1)
        assert ala["total_aadt"] == 10000
        assert ala["segment_count"] == 1

    def test_skips_unknown_county_abbreviation(self):
        """Segments with unrecognized county codes should be skipped."""
        segments = [
            {"CNTY": "FAKE", "AHEAD_AADT": 99999},
            {"CNTY": "LA", "AHEAD_AADT": 5000},
        ]

        results = aggregate_by_county(segments, MOCK_NAME_TO_CODE)

        assert len(results) == 1
        assert results[0]["county_code"] == 19

    def test_handles_null_aadt(self):
        """Segments with None AADT should default to 0."""
        segments = [
            {"CNTY": "LA", "AHEAD_AADT": None},
        ]

        results = aggregate_by_county(segments, MOCK_NAME_TO_CODE)

        assert results[0]["total_aadt"] == 0
        assert results[0]["segment_count"] == 1

    def test_handles_string_aadt(self):
        """AADT values from the API come as strings — should be cast to int."""
        segments = [
            {"CNTY": "LA", "AHEAD_AADT": "12345"},
        ]

        results = aggregate_by_county(segments, MOCK_NAME_TO_CODE)

        assert results[0]["total_aadt"] == 12345

    def test_empty_input(self):
        """No segments should produce no results."""
        results = aggregate_by_county([], MOCK_NAME_TO_CODE)
        assert results == []

    def test_skips_county_not_in_db(self):
        """Counties in the abbreviation map but not in the DB lookup should be skipped."""
        segments = [
            {"CNTY": "SD", "AHEAD_AADT": 5000},  # SD maps to San Diego, code 37
        ]
        limited_lookup = {"Los Angeles": 19}  # San Diego not in lookup

        results = aggregate_by_county(segments, limited_lookup)

        assert len(results) == 0
