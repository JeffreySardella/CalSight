"""Tests for etl.backup dump-integrity verification (audit 2026-07-09 M9).

A truncated or corrupt dump must never be reported as a successful backup:
run_backup verifies the archive TOC with `pg_restore --list` and quarantines
files that fail, so rotation and R2 upload never treat them as recovery
points.
"""

import subprocess
from unittest.mock import patch

from etl.backup import run_backup, verify_dump


def _fake_run_factory(dump_rc: int = 0, verify_rc: int = 0):
    """Return a subprocess.run stand-in covering pg_dump and pg_restore."""

    def fake_run(cmd, **kwargs):
        if cmd[0] == "pg_dump":
            # Create the file the way pg_dump would.
            target = next(a for a in cmd if a.startswith("--file=")).split("=", 1)[1]
            with open(target, "w") as f:
                f.write("not a real dump")
            return subprocess.CompletedProcess(cmd, dump_rc, stdout="", stderr="")
        if cmd[0] == "pg_restore":
            return subprocess.CompletedProcess(cmd, verify_rc, stdout="", stderr="corrupt")
        raise AssertionError(f"unexpected command {cmd}")

    return fake_run


def test_verify_dump_passes_on_zero_exit(tmp_path):
    f = tmp_path / "calsight_2026-07-09.dump"
    f.write_text("x")
    with patch("etl.backup.subprocess.run", _fake_run_factory()):
        assert verify_dump(f) is True


def test_verify_dump_fails_on_nonzero_exit(tmp_path):
    f = tmp_path / "calsight_2026-07-09.dump"
    f.write_text("x")
    with patch("etl.backup.subprocess.run", _fake_run_factory(verify_rc=1)):
        assert verify_dump(f) is False


def test_run_backup_quarantines_corrupt_dump(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/calsight")
    with patch("etl.backup.subprocess.run", _fake_run_factory(verify_rc=1)):
        result = run_backup(str(tmp_path))

    assert result is None
    # The bad file is quarantined out of the recovery-point namespace.
    assert list(tmp_path.glob("calsight_*.dump")) == []
    assert len(list(tmp_path.glob("calsight_*.dump.corrupt"))) == 1


def test_run_backup_returns_path_on_verified_dump(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/calsight")
    with patch("etl.backup.subprocess.run", _fake_run_factory()):
        result = run_backup(str(tmp_path))

    assert result is not None
    assert result.name.endswith(".dump")
    assert result.exists()
