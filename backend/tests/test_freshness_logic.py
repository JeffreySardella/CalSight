"""Unit tests for the pure staleness-decision helper.

These run without a database. The core behavior under test: a source is
"stale" only when we haven't *confirmed sync* with upstream (loaded new
rows OR verified upstream is unchanged) within its threshold — NOT merely
because the last row-load is old. Static annual sources (census, hospitals)
load rarely but are checked daily, so they should read as fresh.
"""

from datetime import datetime, timedelta

from app.freshness_logic import (
    STALENESS_THRESHOLDS,
    compute_staleness,
    stale_sources,
)


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


# ---------------------------------------------------------------------------
# stale_sources — the sweep the pipeline alerts from (2026-07-17: every
# monthly source sat 2 months stale and nothing fired, because is_stale
# lived only on the deprecated /api/freshness endpoint nobody reads).
# ---------------------------------------------------------------------------


def test_stale_sources_flags_only_overdue_sources():
    checks = {
        "crashes_ccrs": NOW - timedelta(hours=5),     # fresh (48h threshold)
        "weather": NOW - timedelta(days=45),          # stale (720h threshold)
    }
    stale = stale_sources(NOW, checks, {"crashes_ccrs", "weather"})
    assert [s[0] for s in stale] == ["weather"]
    source, hours, threshold = stale[0]
    assert hours == 1080.0
    assert threshold == 720


def test_stale_sources_never_synced_source_is_stale():
    stale = stale_sources(NOW, {}, {"weather"})
    assert len(stale) == 1
    source, hours, threshold = stale[0]
    assert source == "weather"
    assert hours is None


def test_stale_sources_unknown_source_uses_default_threshold():
    # A job not in the thresholds table gets the 1-week default (mirrors
    # the /api/freshness router behavior).
    checks = {"brand_new_job": NOW - timedelta(hours=169)}
    stale = stale_sources(NOW, checks, {"brand_new_job"})
    assert [s[0] for s in stale] == ["brand_new_job"]
    assert stale[0][2] == 168


def test_stale_sources_oldest_sync_first_with_never_synced_leading():
    checks = {
        "weather": NOW - timedelta(days=45),       # 1080h since last sync
        "crashes_ccrs": NOW - timedelta(days=30),  # 720h since last sync
    }
    stale = stale_sources(NOW, checks, {"weather", "crashes_ccrs", "never_loaded"})
    assert [s[0] for s in stale] == ["never_loaded", "weather", "crashes_ccrs"]


def test_stale_sources_empty_when_all_fresh():
    checks = {"reservoirs": NOW - timedelta(hours=2)}
    assert stale_sources(NOW, checks, {"reservoirs"}) == []


def test_thresholds_table_covers_the_monthly_sources():
    # The dict moved here from the freshness router so the pipeline sweep
    # and the API can never drift apart. Pin the sources that motivated it.
    for source in ("weather", "demographics", "unemployment", "vehicles", "calenviroscreen"):
        assert STALENESS_THRESHOLDS[source] == 720
