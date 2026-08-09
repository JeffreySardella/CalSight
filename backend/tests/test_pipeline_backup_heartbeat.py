"""pipeline.run_backup must honor the same heartbeat contract as etl.backup.

PR #391 made the standalone etl.backup exit non-zero when the offsite (R2)
upload fails, so a green dead-man's switch means the offsite copy landed too.
The scheduler's own run_backup was a second implementation of that contract
and still pinged the heartbeat GREEN on an offsite failure — leaving the
monitor satisfied while offsite copies silently went stale.
"""

from pathlib import Path
from unittest.mock import patch

import etl.pipeline as pipeline


def _fake_dump(tmp_path: Path) -> Path:
    dump = tmp_path / "calsight_2026-08-08.dump"
    dump.write_text("x" * 2048)
    return dump


def _run(tmp_path, *, upload_ok, r2_configured):
    env = {"BACKUP_DIR": str(tmp_path)}
    if r2_configured:
        env["R2_BUCKET_NAME"] = "calsight-backups"
    with (
        patch.dict("os.environ", env, clear=False),
        patch("etl.backup.run_backup", return_value=_fake_dump(tmp_path)),
        patch("etl.backup.upload_to_r2", return_value=upload_ok),
        patch("etl.backup.rotate_backups", return_value=0),
        patch("etl.backup.rotate_r2_backups", return_value=0),
        patch("etl.pipeline.send_alert"),
        patch("etl.pipeline.send_heartbeat") as heartbeat,
    ):
        if not r2_configured:
            # Ensure a leaked R2 var from the real environment doesn't flip
            # the "configured" branch.
            import os
            os.environ.pop("R2_BUCKET_NAME", None)
        result = pipeline.run_backup()
    return result, heartbeat


def test_offsite_failure_reports_down(tmp_path):
    result, heartbeat = _run(tmp_path, upload_ok=False, r2_configured=True)
    assert result is False
    heartbeat.assert_called_once_with(success=False)


def test_full_success_reports_up(tmp_path):
    result, heartbeat = _run(tmp_path, upload_ok=True, r2_configured=True)
    assert result is True
    heartbeat.assert_called_once_with(success=True)


def test_offsite_disabled_is_not_a_failure(tmp_path):
    # R2 not configured: a False upload result is expected (skipped), not a
    # failure — the local dump is the whole job.
    result, heartbeat = _run(tmp_path, upload_ok=False, r2_configured=False)
    assert result is True
    heartbeat.assert_called_once_with(success=True)


def test_dump_failure_reports_down(tmp_path):
    with (
        patch.dict("os.environ", {"BACKUP_DIR": str(tmp_path)}, clear=False),
        patch("etl.backup.run_backup", return_value=None),
        patch("etl.pipeline.send_alert"),
        patch("etl.pipeline.send_heartbeat") as heartbeat,
    ):
        assert pipeline.run_backup() is False
    heartbeat.assert_called_once_with(success=False)
