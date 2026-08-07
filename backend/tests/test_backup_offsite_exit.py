"""Tests that a failed offsite upload fails the whole backup run.

The nightly cron pings the heartbeat only when `python -m etl.backup` exits 0.
Before this, a successful local dump whose R2 upload failed still exited 0, so
the dead-man's switch stayed green while the offsite copies — the only ones
that survive the box dying — silently went stale.
"""

from pathlib import Path
from unittest.mock import patch

from etl.backup import main

R2_ENV = {
    "R2_ACCESS_KEY_ID": "key",
    "R2_SECRET_ACCESS_KEY": "secret",
    "R2_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
    "R2_BUCKET_NAME": "calsight-backups",
}


def _run_main(tmp_path: Path, *, r2_env: dict, upload_ok: bool) -> int:
    dump = tmp_path / "calsight_2026-08-07.dump"
    dump.write_text("x" * 1024)

    with (
        patch("sys.argv", ["etl.backup", "--dir", str(tmp_path)]),
        patch.dict("os.environ", r2_env, clear=False),
        patch("etl.backup.run_backup", return_value=dump),
        patch("etl.backup.upload_to_r2", return_value=upload_ok),
        patch("etl.backup.rotate_backups", return_value=0),
        patch("etl.backup.rotate_r2_backups", return_value=0),
        patch("etl.backup._notify_discord"),
    ):
        return main()


def test_offsite_upload_failure_exits_nonzero(tmp_path):
    """R2 configured but upload failed -> exit 1 so the heartbeat goes DOWN."""
    assert _run_main(tmp_path, r2_env=R2_ENV, upload_ok=False) == 1


def test_offsite_upload_success_exits_zero(tmp_path):
    assert _run_main(tmp_path, r2_env=R2_ENV, upload_ok=True) == 0


def test_r2_not_configured_still_exits_zero(tmp_path):
    """Offsite intentionally disabled is not a failure — only broken offsite is."""
    cleared = {k: "" for k in R2_ENV}
    assert _run_main(tmp_path, r2_env=cleared, upload_ok=False) == 0


def test_failed_dump_still_exits_nonzero(tmp_path):
    """Regression guard: the pre-existing pg_dump failure path must still fail."""
    with (
        patch("sys.argv", ["etl.backup", "--dir", str(tmp_path)]),
        patch("etl.backup.run_backup", return_value=None),
        patch("etl.backup._notify_discord"),
    ):
        assert main() == 1
