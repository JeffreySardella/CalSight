"""Unit tests for FARS aggregation helpers (no DB, no network)."""

from etl.nhtsa_fars import build_county_lookup, aggregate_fars


def test_build_county_lookup_maps_last_three_fips_digits():
    lookup = build_county_lookup([(1, "06001"), (19, "06037"), (30, "06059")])
    assert lookup == {1: 1, 37: 19, 59: 30}


def test_build_county_lookup_skips_missing_fips():
    lookup = build_county_lookup([(1, "06001"), (99, None), (98, "")])
    assert lookup == {1: 1}


def _person(state="6", county="37", inj="4", rest="3"):
    return {"STATE": state, "COUNTY": county, "INJ_SEV": inj, "REST_USE": rest}


def test_aggregate_counts_fatalities_per_county():
    lookup = {37: 19, 59: 30}
    rows = [_person(county="37"), _person(county="37"), _person(county="59")]
    out = {r["county_code"]: r for r in aggregate_fars(rows, lookup, 2022)}
    assert out[19]["fatalities"] == 2
    assert out[30]["fatalities"] == 1
    assert out[19]["year"] == 2022


def test_aggregate_classifies_restraint():
    lookup = {37: 19}
    rows = [
        _person(rest="0"),   # unrestrained + known (older FARS "None Used")
        _person(rest="3"),   # restrained + known
        _person(rest="99"),  # unknown -> excluded from denominator
    ]
    out = aggregate_fars(rows, lookup, 2022)[0]
    assert out["fatalities"] == 3
    assert out["unrestrained_killed"] == 1
    assert out["restraint_known_killed"] == 2


def test_aggregate_counts_modern_none_used_code_20():
    # Modern FARS (2010s+) codes "None Used" as 20, not 0. Code 96 = "Not a
    # Motor Vehicle Occupant" (pedestrian) -> excluded from the denominator.
    lookup = {37: 19}
    rows = [
        _person(rest="20"),  # unrestrained + known (modern "None Used")
        _person(rest="3"),   # restrained + known
        _person(rest="96"),  # non-occupant -> excluded from denominator
    ]
    out = aggregate_fars(rows, lookup, 2022)[0]
    assert out["fatalities"] == 3
    assert out["unrestrained_killed"] == 1
    assert out["restraint_known_killed"] == 2


def test_aggregate_skips_non_ca_and_non_fatal_and_unmapped():
    lookup = {37: 19}
    rows = [
        _person(state="48"),            # not CA
        _person(inj="1"),               # injured, not killed
        _person(county="999"),          # unmapped county
        _person(),                      # valid -> counted
    ]
    out = aggregate_fars(rows, lookup, 2022)
    assert len(out) == 1
    assert out[0]["county_code"] == 19
    assert out[0]["fatalities"] == 1


def test_fars_job_registered():
    from etl.jobs import build_default_registry

    registry = build_default_registry()
    job = registry.get("fars")
    assert job is not None
    assert job.module == "etl.nhtsa_fars"
    assert job.table_name == "fars_county_year"


class TestLoudFailure:
    """Audit M8: per-year exceptions were swallowed at WARNING — an NHTSA
    outage or schema change failing EVERY year still recorded success."""

    def test_failing_years_raise(self, monkeypatch):
        import pytest
        from unittest.mock import MagicMock
        from etl import _utils
        from etl import nhtsa_fars as mod

        db = MagicMock()
        db.query.return_value.all.return_value = []
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)
        monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
        from types import SimpleNamespace as _NS
        monkeypatch.setattr(_utils, "EtlRun", lambda **kw: _NS(**{"id": 1, "rows_loaded": None, **kw}))

        def boom(year):
            raise RuntimeError("NHTSA down")

        monkeypatch.setattr(mod, "fetch_year", boom)

        with pytest.raises(RuntimeError, match="failed"):
            mod.run(start_year=2020, end_year=2021)

    def test_unpublished_year_404_skips_quietly(self, monkeypatch):
        import httpx
        from unittest.mock import MagicMock
        from etl import _utils
        from etl import nhtsa_fars as mod

        db = MagicMock()
        db.query.return_value.all.return_value = []
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)
        monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
        from types import SimpleNamespace as _NS
        monkeypatch.setattr(_utils, "EtlRun", lambda **kw: _NS(**{"id": 1, "rows_loaded": None, **kw}))

        def not_published(year):
            raise httpx.HTTPStatusError(
                "404", request=MagicMock(), response=MagicMock(status_code=404)
            )

        monkeypatch.setattr(mod, "fetch_year", not_published)

        # FARS publishes 1-2 years behind; a trailing-year 404 must not fail
        # the run every month until NHTSA releases the file.
        mod.run(start_year=2024, end_year=2025)
