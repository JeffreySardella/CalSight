"""M6 — validation outcomes must be consumed, not just recorded.

The orchestrator writes etl_runs.validation_status but keeps job status
"success" (validation is non-blocking by design). Before this fix the
scheduler's summary alerts only looked at status == "error", so a >5%
row-drop validation failure produced the "All jobs completed successfully"
INFO alert. These tests pin the WARNING alert that now surfaces failed
validations from both the daily and weekly pipelines.
"""

from types import SimpleNamespace

import pytest

import etl.pipeline as pipeline
from etl.alerts import AlertLevel


def _result(
    source="crashes_ccrs",
    status="success",
    validation_status="passed",
    error_message=None,
    diff_summary=None,
):
    """EtlRun stand-in with just the fields the summary alerts read."""
    return SimpleNamespace(
        source=source,
        status=status,
        validation_status=validation_status,
        error_message=error_message,
        diff_summary=diff_summary,
    )


@pytest.fixture
def alerts(monkeypatch):
    """Capture send_alert calls; stub the disk check so no alert noise."""
    calls = []
    monkeypatch.setattr(
        pipeline,
        "send_alert",
        lambda level, title, body="": calls.append((level, title, body)) or True,
    )
    monkeypatch.setattr(
        pipeline, "check_disk_and_alert", lambda: {"summary": "1.0G / 10.0G (10%)"}
    )
    return calls


def _patch_run(monkeypatch, results):
    monkeypatch.setattr(pipeline, "build_default_registry", lambda: object())
    monkeypatch.setattr(pipeline, "run_pipeline", lambda *a, **k: results)


def _levels(calls):
    return [level for level, _title, _body in calls]


class TestDailyPipelineValidationAlerts:
    def test_all_green_sends_single_info_and_no_warning(self, alerts, monkeypatch):
        _patch_run(monkeypatch, [
            _result(source="crashes_ccrs"),
            _result(source="parties"),
        ])

        pipeline.run_daily_pipeline()

        assert _levels(alerts) == [AlertLevel.INFO]

    def test_failed_validation_sends_warning(self, alerts, monkeypatch):
        _patch_run(monkeypatch, [
            _result(source="parties"),
            _result(
                source="crashes_ccrs",
                validation_status="failed",
                diff_summary="crashes_row_count: dropped 8.2% (max 5.0%)",
            ),
        ])

        pipeline.run_daily_pipeline()

        warnings = [c for c in alerts if c[0] == AlertLevel.WARNING]
        assert len(warnings) == 1
        _level, title, body = warnings[0]
        assert "validation FAILED" in title
        assert "crashes_ccrs" in body
        assert "dropped 8.2%" in body
        # The success INFO alert still goes out — the loads DID succeed.
        assert AlertLevel.INFO in _levels(alerts)

    def test_failed_validation_alert_fires_alongside_job_error_alert(
        self, alerts, monkeypatch
    ):
        _patch_run(monkeypatch, [
            _result(
                source="parties",
                status="error",
                validation_status="skipped",
                error_message="Non-zero exit code 1",
            ),
            _result(
                source="crashes_ccrs",
                validation_status="failed",
                diff_summary="crashes_row_count: dropped 50.0% (max 5.0%)",
            ),
        ])

        pipeline.run_daily_pipeline()

        assert AlertLevel.ERROR in _levels(alerts)
        assert AlertLevel.WARNING in _levels(alerts)

    def test_validation_warning_or_skipped_do_not_alert(self, alerts, monkeypatch):
        """Only 'failed' (critical checks) alerts; warnings stay in etl_runs."""
        _patch_run(monkeypatch, [
            _result(source="crashes_ccrs", validation_status="warning"),
            _result(source="vacuum", validation_status="skipped"),
            _result(source="matviews", validation_status=None),
        ])

        pipeline.run_daily_pipeline()

        assert AlertLevel.WARNING not in _levels(alerts)

    def test_multiple_failures_are_listed_together(self, alerts, monkeypatch):
        _patch_run(monkeypatch, [
            _result(source="crashes_ccrs", validation_status="failed",
                    diff_summary="crashes_row_count: dropped 9%"),
            _result(source="victims", validation_status="failed",
                    diff_summary=None),
        ])

        pipeline.run_daily_pipeline()

        warnings = [c for c in alerts if c[0] == AlertLevel.WARNING]
        assert len(warnings) == 1
        _level, title, body = warnings[0]
        assert "2 job(s)" in title
        assert "crashes_ccrs" in body
        assert "victims" in body
        assert "no details recorded" in body  # None diff_summary handled


class TestWeeklyPipelineValidationAlerts:
    def test_failed_validation_sends_warning(self, alerts, monkeypatch):
        _patch_run(monkeypatch, [
            _result(
                source="parties",
                validation_status="failed",
                diff_summary="crash_parties_row_count: dropped 12.0% (max 10.0%)",
            ),
        ])

        pipeline.run_weekly_pipeline()

        warnings = [c for c in alerts if c[0] == AlertLevel.WARNING]
        assert len(warnings) == 1
        assert "Weekly refresh" in warnings[0][1]
        assert "parties" in warnings[0][2]

    def test_all_green_sends_only_info(self, alerts, monkeypatch):
        _patch_run(monkeypatch, [_result(source="parties")])

        pipeline.run_weekly_pipeline()

        assert _levels(alerts) == [AlertLevel.INFO]
