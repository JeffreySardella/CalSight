"""Tests for the Census API client.

These use mocking — we fake the HTTP responses so tests don't hit
the real Census API. This makes tests fast, reliable, and free.
"""

import httpx
import pytest
from unittest.mock import patch, MagicMock

from etl.census_api import fetch_county_demographics


# This is what the Census API actually returns — a list of lists
# where the first row is headers and the rest are data.
MOCK_RESPONSE_JSON = [
    ["B01003_001E", "B01002_001E", "B19013_001E",
     "B08006_003E", "B08006_004E", "B08006_008E",
     "B08006_005E", "B08006_014E", "B08006_017E",
     "B08006_001E", "state", "county"],
    ["1000000", "35.2", "65000",
     "500000", "80000", "50000",
     "30000", "10000", "70000",
     "800000", "06", "001"],
]


def _mock_success(json_data=None):
    """Helper: create a mock httpx response that returns given JSON."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = json_data or MOCK_RESPONSE_JSON
    mock_resp.raise_for_status = MagicMock()
    return mock_resp


class TestFetchCountyDemographics:
    @patch("etl.census_api.httpx.get")
    def test_returns_parsed_rows(self, mock_get):
        """One data row in -> one parsed dict out."""
        mock_get.return_value = _mock_success()

        rows = fetch_county_demographics(year=2022, api_key="fake-key")

        assert len(rows) == 1
        assert rows[0]["county_fips"] == "001"
        assert rows[0]["population"] == 1000000
        assert rows[0]["median_age"] == 35.2
        assert rows[0]["median_income"] == 65000

    @patch("etl.census_api.httpx.get")
    def test_uses_acs5_for_2010_and_later(self, mock_get):
        """ACS 5-year has full county coverage, used for 2010+."""
        mock_get.return_value = _mock_success()

        fetch_county_demographics(year=2015, api_key="fake-key")

        url = mock_get.call_args[0][0]
        assert "/acs/acs5" in url

    @patch("etl.census_api.httpx.get")
    def test_uses_acs1_for_2009_and_earlier(self, mock_get):
        """ACS 1-year is all that's available pre-2010."""
        mock_get.return_value = _mock_success()

        fetch_county_demographics(year=2009, api_key="fake-key")

        url = mock_get.call_args[0][0]
        assert "/acs/acs1" in url

    @patch("etl.census_api.httpx.get")
    def test_computes_commute_percentages(self, mock_get):
        """Raw counts get divided by total workers to make percentages."""
        mock_get.return_value = _mock_success()

        rows = fetch_county_demographics(year=2022, api_key="fake-key")

        row = rows[0]
        # 500000 / 800000 * 100 = 62.5
        assert row["commute_drive_alone_pct"] == pytest.approx(62.5)
        # 80000 / 800000 * 100 = 10.0
        assert row["commute_carpool_pct"] == pytest.approx(10.0)
        # 70000 / 800000 * 100 = 8.75
        assert row["commute_wfh_pct"] == pytest.approx(8.75)

    @patch("etl.census_api.httpx.get")
    def test_handles_null_values(self, mock_get):
        """ACS 1-year returns null for small counties — we store None."""
        response_with_nulls = [
            MOCK_RESPONSE_JSON[0],  # header row stays the same
            [None, None, None,
             None, None, None,
             None, None, None,
             None, "06", "003"],
        ]
        mock_get.return_value = _mock_success(response_with_nulls)

        rows = fetch_county_demographics(year=2006, api_key="fake-key")

        assert len(rows) == 1
        assert rows[0]["population"] is None
        assert rows[0]["commute_drive_alone_pct"] is None

    @patch("etl.census_api.httpx.get")
    def test_retries_on_server_error(self, mock_get):
        """Should retry up to 3 times on 500 errors, then raise."""
        mock_get.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=MagicMock(status_code=500)
        )

        with pytest.raises(httpx.HTTPStatusError):
            fetch_county_demographics(year=2022, api_key="fake-key")

        assert mock_get.call_count == 3
