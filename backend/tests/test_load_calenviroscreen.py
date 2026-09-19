"""Tests for the CalEnviroScreen ETL (CES 5.0 field names)."""

from etl.load_calenviroscreen import (
    aggregate_to_counties,
    build_tract_rows,
    normalize_geoid,
    _safe_float,
)


class TestSafeFloat:
    def test_valid_number(self):
        assert _safe_float(42.5) == 42.5

    def test_string_number(self):
        assert _safe_float("3.14") == 3.14

    def test_none(self):
        assert _safe_float(None) is None

    def test_empty_string(self):
        assert _safe_float("") is None

    def test_na_string(self):
        assert _safe_float("NA") is None


class TestAggregateToCounties:
    def test_aggregates_single_county(self):
        """Two tracts in Alameda -> one county row with weighted average."""
        tracts = [
            {
                "tract": 6001400100,  # Alameda tract
                "Population": 5000,
                "CIscore": 30.0,
                "CIscoreP": 50.0,
                "PollutionScore": 5.0,
                "PopCharScore": 4.0,
                "PM2_5": 10.0, "ozone": 0.04, "Diesel_PM": 0.5,
                "Pesticides": 0.0, "traffic": 1000.0,
                "Poverty": 20.0, "Unemployment": 5.0, "Education": 15.0,
                "Linguistic_Isol": 10.0, "HousBurd": 30.0,
            },
            {
                "tract": 6001400200,  # Another Alameda tract
                "Population": 3000,
                "CIscore": 20.0,
                "CIscoreP": 30.0,
                "PollutionScore": 3.0,
                "PopCharScore": 2.0,
                "PM2_5": 8.0, "ozone": 0.03, "Diesel_PM": 0.3,
                "Pesticides": 0.0, "traffic": 800.0,
                "Poverty": 10.0, "Unemployment": 3.0, "Education": 10.0,
                "Linguistic_Isol": 5.0, "HousBurd": 20.0,
            },
        ]
        fips_to_code = {"06001": 1}

        result = aggregate_to_counties(tracts, fips_to_code)

        assert 1 in result
        county = result[1]
        assert county["tract_count"] == 2
        assert county["total_population"] == 8000
        # Weighted avg CES: (30*5000 + 20*3000) / 8000 = 26.25
        assert county["ces_score"] == 26.25

    def test_skips_zero_population_tracts(self):
        tracts = [
            {"tract": 6001400100, "Population": 0, "CIscore": 50.0},
        ]
        fips_to_code = {"06001": 1}

        result = aggregate_to_counties(tracts, fips_to_code)
        assert len(result) == 0

    def test_skips_unknown_counties(self):
        tracts = [
            {"tract": 9999900100, "Population": 1000, "CIscore": 50.0},
        ]
        fips_to_code = {"06001": 1}

        result = aggregate_to_counties(tracts, fips_to_code)
        assert len(result) == 0

    def test_handles_missing_fields_gracefully(self):
        tracts = [
            {"tract": 6001400100, "Population": 1000},
        ]
        fips_to_code = {"06001": 1}

        result = aggregate_to_counties(tracts, fips_to_code)
        assert result[1]["ces_score"] is None


class TestNormalizeGeoid:
    def test_pads_californias_missing_leading_zero(self):
        # ArcGIS returns the tract as a number, so "06..." arrives as "6...".
        assert normalize_geoid(6001400100) == "06001400100"

    def test_keeps_an_already_11_digit_code(self):
        assert normalize_geoid("06001400100") == "06001400100"

    def test_rejects_garbage(self):
        assert normalize_geoid(None) is None
        assert normalize_geoid("not-a-tract") is None
        assert normalize_geoid(12345) is None  # too short to be a GEOID


class TestBuildTractRows:
    TRACT = {
        "tract": 6001400100,
        "Population": 5000,
        "CIscore": 30.0,
        "CIscoreP": 62.5,
        "PollutionScore": 5.0,
        "PopCharScore": 4.0,
    }

    def test_maps_the_ces_fields_onto_tract_ces_columns(self):
        rows = build_tract_rows([self.TRACT], {"06001": 1})
        assert rows == [{
            "geoid": "06001400100",
            "county_code": 1,
            "ces_score": 30.0,
            "ces_percentile": 62.5,
            "pollution_burden": 5.0,
            "pop_characteristics": 4.0,
            "population": 5000,
        }]

    def test_keeps_zero_population_tracts(self):
        """Unlike the county average, the tract row survives a 0 population —
        it just can't carry a per-capita rate."""
        rows = build_tract_rows([{**self.TRACT, "Population": 0}], {"06001": 1})
        assert len(rows) == 1
        assert rows[0]["population"] == 0

    def test_skips_tracts_in_unknown_counties(self):
        # county_code is a FK; an unmappable FIPS would fail the insert.
        rows = build_tract_rows([{**self.TRACT, "tract": 9999900100}], {"06001": 1})
        assert rows == []

    def test_dedupes_repeated_geoids(self):
        # geoid is the PK — a duplicate in one batch would abort the upsert.
        rows = build_tract_rows([self.TRACT, self.TRACT], {"06001": 1})
        assert len(rows) == 1
