"""Tests for the nClimGrid-Daily county weather ETL.

nClimGrid-Daily replaces the GSOM loader (etl.noaa_weather): NOAA publishes
daily county area-averages as plain bulk CSVs — no API token, gridded rather
than naive station-averaging, and immune to the token-API stall that left the
weather table with zero 2026 rows.

These tests pin the pure parsing/join/aggregation logic against real CSV row
samples, without hitting the network or a database. The county-join landmine
this guards: nClimGrid's numeric code is NOT FIPS (code 06001 in these files
is "CT: Fairfield County", not Alameda) — the join must key off the
state-prefixed county NAME in column 3.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from etl.nclimgrid_weather import (
    MISSING_SENTINEL,
    aggregate_variable,
    build_csv_url,
    california_monthly_values,
    celsius_to_fahrenheit,
    mm_to_inches,
    parse_row,
)

# One real row per variable (June 2026, Alameda County CA), trimmed to a few
# days for readability. Real files carry ~30-31 daily columns + trailing -999.99.
ALAMEDA_TAVG = "cty,04001,CA: Alameda County,2026,06,TAVG,    19.67,    21.90,    19.65,  -999.99"
ALAMEDA_PRCP = "cty,04001,CA: Alameda County,2026,01,PRCP,    14.51,     6.67,     3.54,  -999.99"
FAIRFIELD_CT = "cty,06001,CT: Fairfield County,2026,06,TAVG,    14.78,    12.59,    16.18,  -999.99"


class TestUnitConversion:
    def test_celsius_to_fahrenheit(self):
        assert celsius_to_fahrenheit(0.0) == 32.0
        assert celsius_to_fahrenheit(100.0) == 212.0
        assert celsius_to_fahrenheit(20.0) == 68.0

    def test_mm_to_inches(self):
        # Rounded to 2 decimals — the weather column's storage precision.
        assert mm_to_inches(25.4) == 1.0
        assert mm_to_inches(50.8) == 2.0
        assert mm_to_inches(10.0) == 0.39


class TestParseRow:
    def test_parses_state_county_and_daily_values(self):
        row = parse_row(ALAMEDA_TAVG)
        assert row.state == "CA"
        assert row.county_name == "Alameda"
        assert row.year == 2026
        assert row.month == 6
        assert row.variable == "TAVG"
        # The -999.99 sentinel is dropped, leaving only present daily values.
        assert row.daily == [19.67, 21.90, 19.65]

    def test_county_name_strips_county_suffix(self):
        row = parse_row("cty,04079,CA: San Luis Obispo County,2026,06,TAVG,    18.0,  -999.99")
        assert row.county_name == "San Luis Obispo"

    def test_numeric_code_is_not_fips_join_uses_name(self):
        # code 06001 here is Connecticut, NOT Alameda CA — proves we must not
        # key the join off the numeric column.
        row = parse_row(FAIRFIELD_CT)
        assert row.state == "CT"
        assert row.county_name == "Fairfield"

    def test_ignores_non_data_lines(self):
        assert parse_row("") is None
        assert parse_row("some,unexpected,header") is None

    def test_all_missing_daily_yields_empty_list(self):
        row = parse_row("cty,04001,CA: Alameda County,2026,06,PRCP,  -999.99,  -999.99")
        assert row.daily == []


class TestAggregateVariable:
    def test_temperature_is_mean_of_present_days(self):
        # TAVG aggregates as the monthly mean of daily values.
        assert aggregate_variable("TAVG", [10.0, 20.0, 30.0]) == 20.0

    def test_precipitation_is_sum_of_present_days(self):
        # PRCP aggregates as the monthly total, not the mean.
        assert aggregate_variable("PRCP", [1.0, 2.0, 3.0]) == 6.0

    def test_empty_yields_none(self):
        assert aggregate_variable("TAVG", []) is None
        assert aggregate_variable("PRCP", []) is None


class TestCaliforniaMonthlyValues:
    def test_filters_to_california_and_converts_units(self):
        csv_text = "\n".join([
            "cty,01001,AL: Autauga County,2026,06,TAVG,    26.61,    25.62",  # not CA — dropped
            "cty,04001,CA: Alameda County,2026,06,TAVG,    20.00,    20.00",  # 20C -> 68F
            "cty,06001,CT: Fairfield County,2026,06,TAVG,    14.78,    12.59",  # not CA — dropped
        ])
        result = california_monthly_values(csv_text, "TAVG")
        assert set(result.keys()) == {"Alameda"}
        assert result["Alameda"] == 68.0  # mean(20,20)=20C -> 68F

    def test_precipitation_summed_then_converted_to_inches(self):
        csv_text = "cty,04001,CA: Alameda County,2026,01,PRCP,    25.4,    25.4"
        result = california_monthly_values(csv_text, "PRCP")
        # sum(25.4+25.4)=50.8mm -> 2.0 inches
        assert result["Alameda"] == 2.0

    def test_skips_counties_with_only_missing_values(self):
        csv_text = "cty,04001,CA: Alameda County,2026,06,TAVG,  -999.99,  -999.99"
        assert california_monthly_values(csv_text, "TAVG") == {}


class TestBuildCsvUrl:
    def test_builds_scaled_county_average_url(self):
        url = build_csv_url("prcp", 2026, 6, quality="scaled")
        assert url == (
            "https://www.ncei.noaa.gov/data/nclimgrid-daily/access/averages/"
            "2026/prcp-202606-cty-scaled.csv"
        )

    def test_zero_pads_month(self):
        url = build_csv_url("tavg", 2026, 1)
        assert "tavg-202601-cty-scaled.csv" in url


class TestMissingSentinel:
    def test_sentinel_constant(self):
        assert MISSING_SENTINEL == -999.99


def _patch_etl_run_tracking(monkeypatch):
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRunFailureHandling:
    def test_month_fetch_failure_raises_but_other_months_load(self, monkeypatch):
        """A per-month CSV fetch failure must not be swallowed — the run raises
        at the end, but months that succeeded are still committed (M-B9)."""
        from etl import nclimgrid_weather as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod.time, "sleep", lambda *_: None)

        db = MagicMock()
        # county name -> code map query
        db.query.return_value.all.return_value = [(1, "Alameda")]
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)

        def fake_fetch(variable, year, month):
            if (year, month) == (2026, 1):
                raise RuntimeError("NCEI 503")
            return f"cty,04001,CA: Alameda County,{year},{month:02d},{variable.upper()},    20.0"

        monkeypatch.setattr(mod, "fetch_variable_csv", fake_fetch)

        with pytest.raises(RuntimeError, match="1 month"):
            mod.run(year_months=[(2026, 1), (2026, 2)])

        # The successful month (2026-02) still upserted + committed.
        assert db.execute.called
        assert db.commit.called
