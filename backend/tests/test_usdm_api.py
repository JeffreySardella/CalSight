"""Tests for the US Drought Monitor API client.

Mocked HTTP throughout, matching test_cdec_api.py. Live response-shape
validation happens via `python -m etl.usdm_api --smoke`.
"""

import httpx
import pytest
from datetime import date
from unittest.mock import patch, MagicMock

from etl.usdm_api import (
    DroughtWeek,
    fetch_county_drought,
    parse_drought_weeks,
)


def _row(**overrides):
    row = {
        "fips": "06067",
        "county": "Sacramento County",
        "state": "CA",
        "mapDate": "2026-06-30",
        "none": "12.34",
        "d0": "45.00",
        "d1": "30.00",
        "d2": "12.66",
        "d3": "0.00",
        "d4": "0.00",
        "validStart": "2026-06-30",
        "validEnd": "2026-07-06",
    }
    row.update(overrides)
    return row


def _mock_response(payload):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = payload
    return mock_resp


class TestParseDroughtWeeks:
    def test_parses_clean_row(self):
        weeks = parse_drought_weeks([_row()])
        assert weeks == [
            DroughtWeek("06067", date(2026, 6, 30), 12.34, 45.0, 30.0, 12.66, 0.0, 0.0)
        ]

    def test_case_insensitive_keys(self):
        row = {k.upper(): v for k, v in _row().items()}
        weeks = parse_drought_weeks([row])
        assert weeks[0].fips == "06067"
        assert weeks[0].d0_pct == 45.0

    def test_falls_back_to_map_date_without_valid_start(self):
        row = _row()
        del row["validStart"]
        assert parse_drought_weeks([row])[0].week_start == date(2026, 6, 30)

    def test_pads_four_digit_fips(self):
        # Some federal APIs strip the leading zero from CA's "06" prefix.
        weeks = parse_drought_weeks([_row(fips="6067")])
        assert weeks[0].fips == "06067"

    def test_drops_missing_percent(self):
        assert parse_drought_weeks([_row(d2=None)]) == []

    def test_drops_negative_percent(self):
        assert parse_drought_weeks([_row(d0="-5")]) == []

    def test_drops_bad_fips(self):
        assert parse_drought_weeks([_row(fips="abcde")]) == []

    def test_drops_unparseable_date(self):
        assert parse_drought_weeks([_row(validStart="soon", mapDate="later")]) == []

    def test_parses_thousands_separators(self):
        weeks = parse_drought_weeks([_row(none="1,00.00")])
        assert weeks[0].none_pct == 100.0

    def test_keeps_good_rows_among_bad(self):
        weeks = parse_drought_weeks([_row(fips=""), _row(), _row(d4="oops")])
        assert len(weeks) == 1


class TestFetchCountyDrought:
    @patch("etl.usdm_api.httpx.get")
    def test_builds_expected_params(self, mock_get):
        mock_get.return_value = _mock_response([_row()])

        fetch_county_drought(date(2026, 1, 5), date(2026, 7, 1))

        params = mock_get.call_args.kwargs["params"]
        assert params["aoi"] == "CA"
        # USDM wants M/D/YYYY, not ISO.
        assert params["startdate"] == "1/5/2026"
        assert params["enddate"] == "7/1/2026"
        assert params["statisticsType"] == "1"

    @patch("etl.usdm_api.time.sleep")
    @patch("etl.usdm_api.httpx.get")
    def test_retries_then_succeeds(self, mock_get, mock_sleep):
        mock_get.side_effect = [httpx.ConnectError("boom"), _mock_response([_row()])]

        raw = fetch_county_drought(date(2026, 1, 1), date(2026, 7, 1))

        assert len(raw) == 1
        assert mock_get.call_count == 2

    @patch("etl.usdm_api.time.sleep")
    @patch("etl.usdm_api.httpx.get")
    def test_raises_after_max_retries(self, mock_get, mock_sleep):
        mock_get.side_effect = httpx.ConnectError("down")

        with pytest.raises(RuntimeError, match="failed after"):
            fetch_county_drought(date(2026, 1, 1), date(2026, 7, 1))

    @patch("etl.usdm_api.time.sleep")
    @patch("etl.usdm_api.httpx.get")
    def test_rejects_non_array_response(self, mock_get, mock_sleep):
        mock_get.return_value = _mock_response({"message": "error"})

        with pytest.raises(RuntimeError):
            fetch_county_drought(date(2026, 1, 1), date(2026, 7, 1))
