"""Tests for the CARB EMFAC VMT loader.

The response fixture is a real EMFAC reply (2023, Alameda + Los Angeles),
trimmed to those two counties and to the columns through `Total VMT`. The
loader must never call the live endpoint from a test.
"""

import json
from pathlib import Path

import pytest

from etl.load_vmt import (
    COUNTY_NAMES,
    FIRST_YEAR,
    LAST_YEAR,
    STATEWIDE_MAX_MILES,
    STATEWIDE_MIN_MILES,
    build_payload,
    county_vmt_miles,
)

FIXTURE = Path(__file__).parent / "fixtures" / "emfac_2023_two_counties.json"


@pytest.fixture
def emfac_response():
    return json.loads(FIXTURE.read_text())


class TestCountyVmtMiles:
    def test_sums_every_vehicle_and_fuel_row_per_county(self, emfac_response):
        totals = county_vmt_miles(emfac_response)
        assert set(totals) == {"Alameda", "Los Angeles"}
        # Values recorded from the live 2023 pull, in miles/year.
        assert totals["Alameda"] == pytest.approx(12_120_144_264.9, rel=1e-9)
        assert totals["Los Angeles"] == pytest.approx(81_997_428_532.0, rel=1e-9)

    def test_millions_conversion_matches_the_published_figure(self, emfac_response):
        totals = county_vmt_miles(emfac_response)
        assert round(totals["Los Angeles"] / 1e6, 1) == 81_997.4

    def test_null_vmt_cells_count_as_zero(self):
        result = {
            "header": ["Region", "Calendar Year", "Total VMT"],
            "output": [["Alpine", 2023, None], ["Alpine", 2023, 5.0]],
        }
        assert county_vmt_miles(result) == {"Alpine": 5.0}


class TestPayload:
    def test_asks_for_all_58_counties(self):
        form = build_payload(2023)["form"]
        assert len(form["region"]) == 58
        assert form["region"][0] == {"fips": "06001", "id": 1, "name": "Alameda"}
        assert form["region"][18] == {"fips": "06037", "id": 19, "name": "Los Angeles"}

    def test_requests_annual_not_per_day_miles(self):
        # "day" is EMFAC's default and would be ~365x low.
        assert build_payload(2023)["form"]["unit"] == "year"

    def test_carries_the_ui_only_fields_the_waf_validates(self):
        # Trimming any of these gets an HTML "Request Rejected" body, not JSON.
        form = build_payload(2023)["form"]
        for field in ("pivotConfig", "outputCols", "version", "showMap",
                      "vehicleCategoryAll", "modelYearAll", "speedAll", "fuelAll"):
            assert field in form, field

    def test_year_goes_into_calendar_years(self):
        assert build_payload(2014)["form"]["calendarYears"] == [2014]


class TestYearRange:
    def test_never_requests_a_forecast_year(self):
        from datetime import date
        assert LAST_YEAR < date.today().year
        assert FIRST_YEAR == 2001


class TestConstants:
    def test_all_58_counties_listed(self):
        assert len(COUNTY_NAMES) == 58
        assert len(set(COUNTY_NAMES)) == 58
        assert COUNTY_NAMES == sorted(COUNTY_NAMES)

    def test_sanity_band_brackets_the_observed_statewide_range(self):
        # 2001-2025 pulls ranged 275.5B (2020) to 335.3B (2019) miles.
        assert STATEWIDE_MIN_MILES < 275e9
        assert STATEWIDE_MAX_MILES > 336e9
