"""Tests for the CARB EMFAC VMT loader.

The response fixture is a real EMFAC reply (2023, Alameda + Los Angeles),
trimmed to those two counties and to the columns through `Total VMT`. The
loader must never call the live endpoint from a test.
"""

import json
from pathlib import Path

import pytest

from etl import load_vmt
from etl.load_vmt import (
    COUNTY_NAMES,
    FIRST_YEAR,
    STATEWIDE_MAX_MILES,
    STATEWIDE_MIN_MILES,
    build_payload,
    check_counties,
    check_statewide,
    county_vmt_miles,
    fetch_year,
    last_complete_year,
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


class TestFetchYear:
    class _Resp:
        def __init__(self, text):
            self.text = text

        def json(self):
            raise AssertionError("must not parse a non-JSON body")

    def test_html_body_raises_instead_of_parsing(self, monkeypatch):
        # A WAF rejection or a CARB outage arrives as 200 OK with HTML.
        body = '<html><head><title>Request Rejected</title></head><body>...</body></html>'
        monkeypatch.setattr(load_vmt, "post_with_retry",
                            lambda *a, **k: self._Resp(body))
        with pytest.raises(RuntimeError, match="HTML, not JSON"):
            fetch_year(2023)

    def test_json_body_is_returned(self, monkeypatch):
        class Ok:
            text = '{"header": [], "output": []}'

            def json(self):
                return {"header": [], "output": []}

        monkeypatch.setattr(load_vmt, "post_with_retry", lambda *a, **k: Ok())
        assert fetch_year(2023) == {"header": [], "output": []}


class TestCheckStatewide:
    def _totals(self, statewide):
        return {name: statewide / len(COUNTY_NAMES) for name in COUNTY_NAMES}

    def test_plausible_total_passes_through(self):
        assert check_statewide(self._totals(318e9), 2023) == pytest.approx(318e9)

    def test_per_day_units_are_caught(self):
        # `unit` reverting to "day" divides the answer by ~365.
        with pytest.raises(ValueError, match="outside the plausible"):
            check_statewide(self._totals(318e9 / 365), 2023)

    def test_absurdly_high_total_is_caught(self):
        with pytest.raises(ValueError, match="outside the plausible"):
            check_statewide(self._totals(900e9), 2023)

    def test_empty_response_cannot_pass_as_zero(self):
        with pytest.raises(ValueError, match="outside the plausible"):
            check_statewide({}, 2023)


class TestCheckCounties:
    def _full(self):
        return {name: 1.0 for name in COUNTY_NAMES}

    def test_all_58_passes(self):
        assert check_counties(self._full(), 2023) is None

    def test_missing_county_raises_and_names_it(self):
        totals = self._full()
        del totals["Alpine"]
        with pytest.raises(ValueError, match="Alpine"):
            check_counties(totals, 2023)

    def test_renamed_county_is_reported_both_ways(self):
        totals = self._full()
        totals["San Luis Obispo County"] = totals.pop("San Luis Obispo")
        with pytest.raises(ValueError) as exc:
            check_counties(totals, 2023)
        assert "San Luis Obispo County" in str(exc.value)
        assert "'San Luis Obispo'" in str(exc.value)

    def test_fixture_is_only_two_counties_so_it_fails_the_check(self, emfac_response):
        with pytest.raises(ValueError, match="expected 58"):
            check_counties(county_vmt_miles(emfac_response), 2023)


class TestYearRange:
    def test_never_requests_a_forecast_year(self):
        from datetime import date
        assert last_complete_year() < date.today().year
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
