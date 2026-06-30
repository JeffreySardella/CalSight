"""Unit tests for the pure staleness-decision helper.

These run without a database. The core behavior under test: a source is
"stale" only when we haven't *confirmed sync* with upstream (loaded new
rows OR verified upstream is unchanged) within its threshold — NOT merely
because the last row-load is old. Static annual sources (census, hospitals)
load rarely but are checked daily, so they should read as fresh.
"""

from datetime import datetime, timedelta

from app.freshness_logic import compute_staleness


NOW = datetime(2026, 6, 30, 12, 0, 0)


def test_static_source_old_load_recent_check_is_fresh():
    # Hospitals: data last changed 50 days ago, but pipeline confirmed
    # "unchanged" upstream 7 hours ago. Not stale.
    is_stale, hours_since_load, hours_since_check = compute_staleness(
        now=NOW,
        last_load_at=NOW - timedelta(days=50),
        last_check_at=NOW - timedelta(hours=7),
        threshold_hours=720,
    )
    assert is_stale is False
    assert hours_since_load == 1200.0  # 50 days
    assert hours_since_check == 7.0


def test_no_check_ever_is_stale():
    is_stale, hours_since_load, hours_since_check = compute_staleness(
        now=NOW,
        last_load_at=None,
        last_check_at=None,
        threshold_hours=720,
    )
    assert is_stale is True
    assert hours_since_load is None
    assert hours_since_check is None


def test_check_older_than_threshold_is_stale():
    # Pipeline hasn't even checked this source in 40 days — genuinely stale.
    is_stale, _, hours_since_check = compute_staleness(
        now=NOW,
        last_load_at=NOW - timedelta(days=45),
        last_check_at=NOW - timedelta(days=40),
        threshold_hours=720,
    )
    assert is_stale is True
    assert hours_since_check == 960.0


def test_recent_load_and_check_is_fresh():
    is_stale, hours_since_load, hours_since_check = compute_staleness(
        now=NOW,
        last_load_at=NOW - timedelta(hours=8),
        last_check_at=NOW - timedelta(hours=8),
        threshold_hours=48,
    )
    assert is_stale is False
    assert hours_since_load == 8.0
    assert hours_since_check == 8.0


def test_check_exactly_at_threshold_is_not_stale():
    # Boundary: equal to threshold is still fresh (strictly-greater is stale).
    is_stale, _, _ = compute_staleness(
        now=NOW,
        last_load_at=NOW - timedelta(hours=48),
        last_check_at=NOW - timedelta(hours=48),
        threshold_hours=48,
    )
    assert is_stale is False
