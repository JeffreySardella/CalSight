"""Tests for the NOAA weather ETL.

Tests the station-level-to-county aggregation logic without
hitting the NOAA API or database, plus the run()-level failure
handling (H1) and the auto-advancing default end year (H2).
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from etl.noaa_weather import DEFAULT_END_YEAR, aggregate_to_monthly


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


class TestDefaultEndYear:
    def test_end_year_tracks_current_year(self):
        """H2: the default end year must auto-advance, not pin to 2025."""
        assert DEFAULT_END_YEAR == datetime.now().year


def _patch_etl_run_tracking(monkeypatch):
    """Stub out the EtlRun bookkeeping so run() needs no database."""
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRunFailureHandling:
    def test_missing_token_exits_nonzero(self, monkeypatch):
        """H1: a missing NOAA_API_TOKEN must exit 1, not return quietly
        (exit 0 made run_job and @track_etl_run record success)."""
        from etl import noaa_weather as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "settings", SimpleNamespace(noaa_api_token=""))

        with pytest.raises(SystemExit) as exc_info:
            mod.run(start_year=2022, end_year=2022)
        assert exc_info.value.code == 1

    def test_county_failure_raises_but_other_counties_still_load(self, monkeypatch):
        """H1: a per-county fetch failure must not be swallowed — the run
        raises at the end, but the counties that succeeded are committed."""
        from etl import noaa_weather as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "settings", SimpleNamespace(noaa_api_token="fake-token"))
        monkeypatch.setattr(mod.time, "sleep", lambda *_: None)

        db = MagicMock()
        db.query.return_value.all.return_value = [
            (1, "06001", "Alameda"),
            (2, "06003", "Alpine"),
        ]
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)

        def fake_fetch(fips, year, token):
            if fips == "06001":
                raise RuntimeError("NOAA 503")
            return [
                {"date": f"{year}-01-01T00:00:00", "datatype": "TAVG", "value": 50.0},
            ]

        monkeypatch.setattr(mod, "fetch_county_weather", fake_fetch)

        with pytest.raises(RuntimeError, match="1 county-year"):
            mod.run(start_year=2022, end_year=2022)

        # The non-failing county's rows were still upserted and committed.
        assert db.execute.called
        assert db.commit.called
