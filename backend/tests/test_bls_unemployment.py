"""Tests for the BLS unemployment ETL."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from etl.bls_unemployment import DEFAULT_END_YEAR, build_series_id, fetch_batch


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


class TestDefaultEndYear:
    def test_end_year_tracks_current_year(self):
        """H2: the default end year must auto-advance, not pin to 2025."""
        assert DEFAULT_END_YEAR == datetime.now().year


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
    def test_raises_on_api_error(self, mock_post):
        """H1: an application-level BLS error (bad key, quota exhausted)
        must raise instead of returning {} — otherwise the run records
        success while loading nothing."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "status": "REQUEST_NOT_PROCESSED",
            "message": ["Invalid series ID"],
        }
        mock_post.return_value = mock_resp

        with pytest.raises(RuntimeError, match="BLS API error"):
            fetch_batch(["BAD_ID"], 2022, 2022, "fake-key")


def _patch_etl_run_tracking(monkeypatch):
    """Stub out the EtlRun bookkeeping so run() needs no database."""
    from etl import _utils

    monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        _utils, "EtlRun",
        lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
    )


class TestRunFailureHandling:
    def test_missing_api_key_exits_nonzero(self, monkeypatch):
        """H1: a missing BLS_API_KEY must exit 1, not record success."""
        from etl import bls_unemployment as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "settings", SimpleNamespace(bls_api_key=""))

        with pytest.raises(SystemExit) as exc_info:
            mod.run(start_year=2022, end_year=2022)
        assert exc_info.value.code == 1

    def test_failed_batch_raises_but_other_batches_still_load(self, monkeypatch):
        """H1: one failed batch must not be swallowed — the run raises,
        but the batches that succeeded are still committed."""
        from etl import bls_unemployment as mod

        _patch_etl_run_tracking(monkeypatch)
        monkeypatch.setattr(mod, "settings", SimpleNamespace(bls_api_key="fake-key"))
        monkeypatch.setattr(mod.time, "sleep", lambda *_: None)
        # Force two batches with only two counties
        monkeypatch.setattr(mod, "BATCH_SIZE", 1)

        db = MagicMock()
        db.execute.return_value.all.return_value = [(1, "06001"), (19, "06037")]
        db.query.return_value.filter_by.return_value.first.return_value = None
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)

        calls = []

        def fake_fetch(batch, yr_start, yr_end, api_key):
            calls.append(list(batch))
            if len(calls) == 1:
                raise RuntimeError("BLS API error: quota exhausted")
            return {
                batch[0]: [
                    {"year": 2022, "month": 1, "unemployment_rate": 4.2},
                ]
            }

        monkeypatch.setattr(mod, "fetch_batch", fake_fetch)

        with pytest.raises(RuntimeError, match="1 batch"):
            mod.run(start_year=2022, end_year=2022)

        # Both batches were attempted; the second one's row was loaded.
        assert len(calls) == 2
        db.add.assert_called_once()
        assert db.commit.called
