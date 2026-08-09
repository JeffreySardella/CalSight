"""Tests for the crash ETL orchestrator.

Tests pure logic (source routing) without needing a database connection.
The actual DB upsert is exercised in the integration test.
"""

from etl.load_crashes import (
    determine_source,
    normalize_city_id,
    select_years_to_load,
)


class TestDetermineSource:
    def test_2001_to_2015_uses_switrs(self):
        for year in (2001, 2010, 2015):
            assert determine_source(year) == "switrs", f"Failed for {year}"

    def test_2016_onwards_uses_ccrs(self):
        for year in (2016, 2020, 2026):
            assert determine_source(year) == "ccrs", f"Failed for {year}"

    def test_boundary_2015_is_switrs(self):
        assert determine_source(2015) == "switrs"

    def test_boundary_2016_is_ccrs(self):
        assert determine_source(2016) == "ccrs"


class TestNormalizeCityId:
    LOOKUP = {
        (19, "los angeles"): 101,
        (19, "long beach"): 102,
        (30, "anaheim"): 201,
    }

    def test_exact_match_resolves(self):
        row = {"county_code": 19, "city_name": "Los Angeles"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] == 101

    def test_uppercase_and_suffix_resolve(self):
        row = {"county_code": 19, "city_name": "LONG BEACH, CA"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] == 102

    def test_wrong_county_returns_none(self):
        # "Anaheim" exists, but only in Orange (30) — should not match in LA (19).
        row = {"county_code": 19, "city_name": "Anaheim"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None

    def test_unknown_city_returns_none(self):
        row = {"county_code": 19, "city_name": "Atlantis"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None

    def test_blank_city_name_returns_none(self):
        row = {"county_code": 19, "city_name": ""}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None

    def test_missing_county_returns_none(self):
        row = {"county_code": None, "city_name": "Los Angeles"}
        normalize_city_id(row, self.LOOKUP)
        assert row["city_id"] is None


class TestSelectYearsToLoad:
    """The daily job must keep re-ingesting recent years: CHP updates the
    CCRS dataset nightly, so a year with rows is not a year that's done."""

    def test_current_and_previous_year_reload_even_when_loaded(self):
        loaded = {2025: 400_000, 2026: 120_000}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", today_year=2026,
        )
        assert 2026 in ccrs
        assert 2025 in ccrs
        assert 2026 not in skipped and 2025 not in skipped

    def test_older_loaded_years_are_skipped(self):
        loaded = {y: 500_000 for y in range(2016, 2027)}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", today_year=2026,
        )
        assert ccrs == [2025, 2026]
        assert skipped == list(range(2016, 2025))

    def test_unloaded_years_always_load(self):
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, {}, source_filter="ccrs", today_year=2026,
        )
        assert ccrs == list(range(2016, 2027))
        assert skipped == []

    def test_force_reloads_everything(self):
        loaded = {y: 500_000 for y in range(2016, 2027)}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", force=True, today_year=2026,
        )
        assert ccrs == list(range(2016, 2027))
        assert skipped == []

    def test_switrs_historical_years_still_skip(self):
        loaded = {y: 300_000 for y in range(2001, 2016)}
        switrs, _, skipped = select_years_to_load(
            2001, 2015, loaded, source_filter="switrs", today_year=2026,
        )
        assert switrs == []
        assert skipped == list(range(2001, 2016))

    def test_partially_loaded_ccrs_year_resumes(self):
        # A historical year that died mid-load (e.g. OOM after 12k of ~450k
        # rows) must not count as loaded — otherwise it is skipped forever
        # and the gap never heals. Reloading is safe (idempotent upsert).
        loaded = {2018: 12_000, 2019: 480_000}
        _, ccrs, skipped = select_years_to_load(
            2016, 2026, loaded, source_filter="ccrs", today_year=2026,
        )
        assert 2018 in ccrs
        assert 2018 not in skipped
        assert 2019 in skipped

    def test_partially_loaded_switrs_year_resumes(self):
        loaded = {2010: 5_000}
        switrs, _, skipped = select_years_to_load(
            2001, 2015, loaded, source_filter="switrs", today_year=2026,
        )
        assert 2010 in switrs
        assert 2010 not in skipped

    def test_year_rollover_shifts_refresh_window(self):
        # On Jan 1 2027 the refresh window becomes {2026, 2027}; 2025 retires.
        loaded = {2025: 400_000, 2026: 500_000}
        _, ccrs, skipped = select_years_to_load(
            2016, 2027, loaded, source_filter="ccrs", today_year=2027,
        )
        assert 2026 in ccrs and 2027 in ccrs
        assert 2025 in skipped

    def test_batch_boundary_truncation_is_resumed(self):
        # SWITRS 2001 died between batches at exactly 310,000 (62 x 5,000)
        # rows — above the absolute floor, so the old heuristic skipped it
        # forever. It is an exact BATCH_SIZE multiple AND far below its peers,
        # so it must be treated as partial and resumed.
        loaded = {2001: 310_000, **{y: 450_000 for y in range(2002, 2016)}}
        switrs, _, skipped = select_years_to_load(
            2001, 2015, loaded, source_filter="switrs", today_year=2026,
        )
        assert 2001 in switrs
        assert 2001 not in skipped

    def test_complete_year_on_a_batch_boundary_is_not_reloaded(self):
        # A genuinely complete year whose count happens to be a multiple of
        # BATCH_SIZE must NOT be reloaded forever — it's near its peers, so the
        # below-median guard keeps it classified as loaded.
        loaded = {2001: 445_000, **{y: 450_000 for y in range(2002, 2016)}}
        switrs, _, skipped = select_years_to_load(
            2001, 2015, loaded, source_filter="switrs", today_year=2026,
        )
        assert 2001 not in switrs
        assert 2001 in skipped

    def test_batch_boundary_rule_needs_peers_to_judge(self):
        # With too few same-source peers to establish a magnitude, the
        # batch-boundary rule stays silent (conservative — no reference, no
        # guess), falling back to the absolute floor alone.
        loaded = {2001: 310_000}
        switrs, _, skipped = select_years_to_load(
            2001, 2015, loaded, source_filter="switrs", today_year=2026,
        )
        assert 2001 in skipped  # above the floor, no peers to contradict it


class TestNoSelfTracking:
    """M-B8: load_crashes must not create its own EtlRun row. The orchestrator's
    run_job is the single tracker; a self-created row (source='ccrs') is a phantom
    source in /api/freshness and double-counts run history."""

    def test_run_does_not_construct_an_etl_run(self, monkeypatch):
        from unittest.mock import MagicMock
        from etl import load_crashes as mod

        etl_run_ctor = MagicMock()
        # raising=False: the loader no longer imports EtlRun at all, which is
        # exactly the fix — if it ever references mod.EtlRun again this mock
        # would catch it.
        monkeypatch.setattr(mod, "EtlRun", etl_run_ctor, raising=False)
        monkeypatch.setattr(mod, "SessionLocal", lambda: MagicMock())
        monkeypatch.setattr(mod, "build_city_lookup", lambda db: {})
        monkeypatch.setattr(mod, "get_loaded_years", lambda db: {})
        # No years to load → run() does only bookkeeping, no network.
        monkeypatch.setattr(mod, "select_years_to_load", lambda *a, **k: ([], [], []))

        mod.run(start_year=2016, end_year=2016, source_filter="ccrs")

        etl_run_ctor.assert_not_called()


class TestCcrsYearsWithResources:
    """Regression for the 2026-07-05 prod incident: crashes_ccrs errored on
    year 2027 (end_year = current+1) because RESOURCE_IDS has no 2027 yet →
    KeyError → failed batch → whole job errored (cascaded to dependents)."""

    def test_drops_years_with_no_published_resource(self):
        from etl.load_crashes import ccrs_years_with_resources
        available = {2016, 2024, 2025, 2026}
        assert ccrs_years_with_resources([2025, 2026, 2027], available) == [2025, 2026]

    def test_keeps_order_of_present_years(self):
        from etl.load_crashes import ccrs_years_with_resources
        assert ccrs_years_with_resources([2016, 2026], {2016, 2026}) == [2016, 2026]

    def test_real_resource_ids_skip_the_next_calendar_year(self):
        from etl.load_crashes import ccrs_years_with_resources
        from etl.ckan_api import RESOURCE_IDS
        latest = max(RESOURCE_IDS)
        # the auto-advanced next year is not loadable; the latest published one is
        assert ccrs_years_with_resources([latest + 1], RESOURCE_IDS) == []
        assert ccrs_years_with_resources([latest], RESOURCE_IDS) == [latest]


class TestAlertCurrentYearUnpublished:
    """H2 follow-through to the 2026-07-05 incident fix: silently skipping an
    unpublished year is correct for the auto-advanced NEXT year, but if the
    CURRENT calendar year has no resource, an entire year of crashes is
    missing while /api/freshness reports green (the pinned prior-year resource
    stops changing -> daily skipped_unchanged -> 'confirmed sync'). That state
    must page a human."""

    def test_missing_current_year_sends_warning(self, monkeypatch):
        from unittest.mock import MagicMock
        from etl import load_crashes as mod

        alert = MagicMock()
        monkeypatch.setattr(mod, "send_alert", alert)

        fired = mod.alert_if_current_year_unpublished(
            {2025: "a", 2026: "b"}, today_year=2027,
        )

        assert fired is True
        alert.assert_called_once()
        level, title = alert.call_args[0][0], alert.call_args[0][1]
        assert level.value == "warning"
        assert "2027" in title

    def test_present_current_year_is_quiet(self, monkeypatch):
        from unittest.mock import MagicMock
        from etl import load_crashes as mod

        alert = MagicMock()
        monkeypatch.setattr(mod, "send_alert", alert)

        fired = mod.alert_if_current_year_unpublished(
            {2026: "b", 2027: "c"}, today_year=2027,
        )

        assert fired is False
        alert.assert_not_called()
