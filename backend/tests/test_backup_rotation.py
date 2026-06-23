"""Tests for etl.backup.rotate_backups — focus on the min_keep guard.

The guard exists so that a run of failed pg_dumps can never rotate away every
local recovery point: at least `min_keep` of the most-recent dumps survive
regardless of age.
"""

from datetime import datetime, timedelta, timezone

from etl.backup import rotate_backups


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
