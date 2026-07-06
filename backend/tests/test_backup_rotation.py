"""Tests for etl.backup.rotate_backups — focus on the min_keep guard.

The guard exists so that a run of failed pg_dumps can never rotate away every
local recovery point: at least `min_keep` of the most-recent dumps survive
regardless of age.
"""

import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from etl.backup import rotate_backups, rotate_r2_backups


def _make_dump(directory, date_str: str):
    f = directory / f"calsight_{date_str}.dump"
    f.write_text("x")
    return f


def _days_ago(n: int) -> str:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return (now - timedelta(days=n)).strftime("%Y-%m-%d")


def test_keeps_min_recent_even_when_all_are_old(tmp_path):
    # Five dumps, all far older than the 7-day retention window.
    for n in range(100, 105):
        _make_dump(tmp_path, _days_ago(n))

    removed = rotate_backups(str(tmp_path), retention_days=7, min_keep=3)

    remaining = list(tmp_path.glob("calsight_*.dump"))
    assert len(remaining) == 3  # newest 3 protected from deletion
    assert removed == 2


def test_removes_old_dumps_beyond_min_keep(tmp_path):
    # Three recent (within retention) + two ancient.
    for n in range(0, 3):
        _make_dump(tmp_path, _days_ago(n))
    for n in (30, 31):
        _make_dump(tmp_path, _days_ago(n))

    removed = rotate_backups(str(tmp_path), retention_days=7, min_keep=3)

    assert removed == 2  # the two ancient dumps are beyond min_keep AND old
    assert len(list(tmp_path.glob("calsight_*.dump"))) == 3


def test_keeps_everything_within_retention(tmp_path):
    # All five within the 7-day window — nothing should be removed.
    for n in range(0, 5):
        _make_dump(tmp_path, _days_ago(n))

    removed = rotate_backups(str(tmp_path), retention_days=7, min_keep=3)

    assert removed == 0
    assert len(list(tmp_path.glob("calsight_*.dump"))) == 5


# ---------------------------------------------------------------------------
# rotate_r2_backups — the OFFSITE copies need the same min_keep guard.
# Without it, 8+ days of silently failing pg_dumps rotates R2 to zero — the
# exact scenario offsite backups exist for (local box dies with stale dumps).
# ---------------------------------------------------------------------------

class _FakeS3:
    def __init__(self, keys):
        self.keys = keys
        self.deleted = []

    def list_objects_v2(self, Bucket, Prefix):
        return {"Contents": [{"Key": k} for k in self.keys]}

    def delete_object(self, Bucket, Key):
        self.deleted.append(Key)


def _r2_env(monkeypatch, s3):
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "k")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "s")
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://r2.example")
    monkeypatch.setenv("R2_BUCKET_NAME", "bucket")
    fake_boto3 = SimpleNamespace(client=lambda *a, **kw: s3)
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)


def _key(days: int) -> str:
    return f"backups/calsight_{_days_ago(days)}.dump"


def test_r2_keeps_min_recent_even_when_all_are_old(monkeypatch):
    s3 = _FakeS3([_key(n) for n in range(100, 105)])
    _r2_env(monkeypatch, s3)

    removed = rotate_r2_backups(retention_days=7, min_keep=3)

    assert removed == 2
    assert len(s3.deleted) == 2
    # the two OLDEST were deleted; the newest three survive
    assert set(s3.deleted) == {_key(103), _key(104)}


def test_r2_removes_old_dumps_beyond_min_keep(monkeypatch):
    s3 = _FakeS3([_key(n) for n in (0, 1, 2, 30, 31)])
    _r2_env(monkeypatch, s3)

    removed = rotate_r2_backups(retention_days=7, min_keep=3)

    assert removed == 2
    assert set(s3.deleted) == {_key(30), _key(31)}


def test_r2_keeps_everything_within_retention(monkeypatch):
    s3 = _FakeS3([_key(n) for n in range(0, 5)])
    _r2_env(monkeypatch, s3)

    removed = rotate_r2_backups(retention_days=7, min_keep=3)

    assert removed == 0
    assert s3.deleted == []


def test_r2_unparseable_names_are_never_deleted(monkeypatch):
    s3 = _FakeS3(["backups/calsight_notadate.dump", _key(100), _key(101), _key(102), _key(103)])
    _r2_env(monkeypatch, s3)

    removed = rotate_r2_backups(retention_days=7, min_keep=3)

    assert "backups/calsight_notadate.dump" not in s3.deleted
    assert removed == 1  # only the oldest parseable dump beyond min_keep
