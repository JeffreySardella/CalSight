"""Tests for the CDEC API client spike.

Mocked HTTP throughout — same conventions as test_ckan_api.py. Live
response-shape validation happens via `python -m etl.cdec_api --smoke`
(the sandbox that authored this module couldn't reach cdec.water.ca.gov).
"""

import httpx
import pytest
from datetime import date
from unittest.mock import patch, MagicMock

from etl.cdec_api import (
    MAJOR_RESERVOIRS,
    MISSING_VALUE,
    SENSOR_STORAGE,
    Observation,
    fetch_reservoir_storage,
    fetch_sensor_data,
    parse_observations,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row(station="SHA", value=3_201_453, raw_date="2026-7-1 00:00", **overrides):
    """One raw servlet row in the documented shape."""
    row = {
        "stationId": station,
        "durCode": "D",
        "sensorNumber": SENSOR_STORAGE,
        "sensorType": "STORAGE",
        "date": raw_date,
        "value": value,
        "dataFlag": " ",
        "units": "AF",
    }
    row.update(overrides)
    return row


def _mock_response(payload, status_code=200):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = payload
    return mock_resp


# ---------------------------------------------------------------------------
# parse_observations
# ---------------------------------------------------------------------------

class TestParseObservations:
    def test_parses_clean_rows(self):
        obs = parse_observations([_row(), _row(raw_date="2026-7-2 00:00", value=3_199_000)])
        assert obs == [
            Observation("SHA", SENSOR_STORAGE, date(2026, 7, 1), 3_201_453.0, "AF"),
            Observation("SHA", SENSOR_STORAGE, date(2026, 7, 2), 3_199_000.0, "AF"),
        ]

    def test_drops_missing_sentinel(self):
        assert parse_observations([_row(value=MISSING_VALUE)]) == []

    def test_drops_dashes_and_none_values(self):
        assert parse_observations([_row(value="---"), _row(value=None)]) == []

    def test_drops_unparseable_value(self):
        assert parse_observations([_row(value="N/A")]) == []

    def test_drops_unparseable_date(self):
        assert parse_observations([_row(raw_date="not a date")]) == []

    def test_drops_blank_station(self):
        assert parse_observations([_row(station="")]) == []

    def test_keeps_good_rows_among_bad(self):
        rows = [_row(value=MISSING_VALUE), _row(), _row(raw_date="garbage")]
        obs = parse_observations(rows)
        assert len(obs) == 1
        assert obs[0].value == 3_201_453.0

    def test_accepts_zero_padded_dates(self):
        obs = parse_observations([_row(raw_date="2026-07-01 00:00")])
        assert obs[0].date == date(2026, 7, 1)

    def test_accepts_string_numeric_value(self):
        obs = parse_observations([_row(value="123.5")])
        assert obs[0].value == 123.5

    def test_normalizes_station_case(self):
        obs = parse_observations([_row(station="sha ")])
        assert obs[0].station_id == "SHA"

    def test_null_sensor_number_does_not_abort_the_row(self):
        # sensorNumber is informational; a null must not crash the parse.
        obs = parse_observations([_row(sensorNumber=None)])
        assert len(obs) == 1
        assert obs[0].sensor == 0


# ---------------------------------------------------------------------------
# fetch_sensor_data
# ---------------------------------------------------------------------------

class TestFetchSensorData:
    """Retry/backoff behavior itself belongs to etl._utils.get_with_retry
    (tested in test_etl_utils.py); here we cover the CDEC-specific
    request shape, delegation, and response validation."""

    @patch("etl.cdec_api.get_with_retry")
    def test_builds_expected_params(self, mock_get):
        mock_get.return_value = _mock_response([_row()])

        fetch_sensor_data(["SHA", "ORO"], SENSOR_STORAGE, date(2026, 6, 1), date(2026, 7, 1))

        params = mock_get.call_args.kwargs["params"]
        assert params["Stations"] == "SHA,ORO"
        assert params["SensorNums"] == str(SENSOR_STORAGE)
        assert params["dur_code"] == "d"
        assert params["Start"] == "2026-06-01"
        assert params["End"] == "2026-07-01"

    @patch("etl._utils.time.sleep")
    @patch("etl._utils.httpx.get")
    def test_retries_transient_failures_via_shared_helper(self, mock_get, mock_sleep):
        mock_get.side_effect = [
            httpx.ConnectError("boom"),
            _mock_response([_row()]),
        ]

        raw = fetch_sensor_data(["SHA"], SENSOR_STORAGE, date(2026, 6, 1), date(2026, 7, 1))

        assert len(raw) == 1
        assert mock_get.call_count == 2

    @patch("etl._utils.time.sleep")
    @patch("etl._utils.httpx.get")
    def test_raises_after_max_retries(self, mock_get, mock_sleep):
        mock_get.side_effect = httpx.ConnectError("down")

        with pytest.raises(httpx.ConnectError):
            fetch_sensor_data(["SHA"], SENSOR_STORAGE, date(2026, 6, 1), date(2026, 7, 1))

    @patch("etl.cdec_api.get_with_retry")
    def test_rejects_non_array_response(self, mock_get):
        # CDEC serves an HTML error page as a JSON string on bad params.
        mock_get.return_value = _mock_response({"error": "bad request"})

        with pytest.raises(ValueError, match="expected a JSON array"):
            fetch_sensor_data(["SHA"], SENSOR_STORAGE, date(2026, 6, 1), date(2026, 7, 1))


# ---------------------------------------------------------------------------
# fetch_reservoir_storage + metadata
# ---------------------------------------------------------------------------

class TestReservoirStorage:
    @patch("etl.cdec_api.get_with_retry")
    def test_requests_all_major_reservoirs(self, mock_get):
        mock_get.return_value = _mock_response([_row()])

        fetch_reservoir_storage(date(2026, 6, 1), date(2026, 7, 1))

        stations = mock_get.call_args.kwargs["params"]["Stations"].split(",")
        assert sorted(stations) == sorted(MAJOR_RESERVOIRS)

    def test_metadata_is_well_formed(self):
        for station_id, meta in MAJOR_RESERVOIRS.items():
            assert station_id == station_id.upper()
            assert meta["name"]
            assert meta["capacity_af"] > 0
            assert meta["county"]
