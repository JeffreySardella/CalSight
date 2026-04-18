"""Tests for the BLS unemployment ETL."""

from etl.bls_unemployment import build_series_id, fetch_batch
from unittest.mock import patch, MagicMock


class TestBuildSeriesId:
    def test_alameda_county(self):
        assert build_series_id("06001") == "LAUCN060010000000003"

    def test_los_angeles_county(self):
        assert build_series_id("06037") == "LAUCN060370000000003"

    def test_yuba_county(self):
        assert build_series_id("06115") == "LAUCN061150000000003"

    def test_format_length(self):
        """BLS LAUS series IDs are always 20 characters."""
        sid = build_series_id("06001")
        assert len(sid) == 20


class TestFetchBatch:
    # Patched at the import site in bls_unemployment — fetch_batch calls
    # post_with_retry (from etl._utils) rather than httpx.post directly,
    # so the mock boundary is the helper, not the raw HTTP call.
    @patch("etl.bls_unemployment.post_with_retry")
    def test_parses_successful_response(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "REQUEST_SUCCEEDED",
            "Results": {
                "series": [
                    {
                        "seriesID": "LAUCN060010000000003",
                        "data": [
                            {"year": "2022", "period": "M12", "value": "3.5"},
                            {"year": "2022", "period": "M11", "value": "3.8"},
                            {"year": "2022", "period": "M13", "value": "4.0"},  # annual avg, skip
                        ],
                    }
                ]
            },
        }
        mock_post.return_value = mock_resp

        results = fetch_batch(["LAUCN060010000000003"], 2022, 2022, "fake-key")

        assert "LAUCN060010000000003" in results
        rows = results["LAUCN060010000000003"]
        assert len(rows) == 2  # M13 skipped
        assert rows[0]["year"] == 2022
        assert rows[0]["month"] == 12
        assert rows[0]["unemployment_rate"] == 3.5

    @patch("etl.bls_unemployment.post_with_retry")
    def test_returns_empty_on_api_error(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "REQUEST_NOT_PROCESSED",
            "message": ["Invalid series ID"],
        }
        mock_post.return_value = mock_resp

        results = fetch_batch(["BAD_ID"], 2022, 2022, "fake-key")
        assert results == {}
