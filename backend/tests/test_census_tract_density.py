"""Unit tests for lived-density helpers (no DB, no network)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from etl.census_tract_density import (
    compute_weighted_density,
    fetch_tract_population,
    gazetteer_year_for,
    aggregate_county_density,
)


def test_weighted_density_two_tracts():
    # tract A: pop 1000, area 1 -> density 1000
    # tract B: pop 3000, area 1 -> density 3000
    # weighted = (1000^2/1 + 3000^2/1) / (1000+3000) = 10_000_000/4000 = 2500
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},
        {"pop": 3000, "area_sqmi": 1.0},
    ])
    assert out == (2500.0, 2)


def test_weighted_density_single_tract_equals_its_density():
    out = compute_weighted_density([{"pop": 500, "area_sqmi": 2.0}])
    assert out == (250.0, 1)


def test_weighted_density_excludes_invalid_tracts():
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},  # valid
        {"pop": 0, "area_sqmi": 1.0},      # pop 0 -> excluded
        {"pop": 500, "area_sqmi": 0.0},    # area 0 -> excluded
        {"pop": None, "area_sqmi": 1.0},   # pop None -> excluded
    ])
    assert out == (1000.0, 1)


def test_weighted_density_excludes_negative_pop():
    out = compute_weighted_density([
        {"pop": 1000, "area_sqmi": 1.0},   # valid
        {"pop": -50, "area_sqmi": 1.0},    # negative -> excluded
    ])
    assert out == (1000.0, 1)


def test_weighted_density_none_when_no_contributing_tracts():
    assert compute_weighted_density([]) is None
    assert compute_weighted_density([{"pop": 0, "area_sqmi": 0.0}]) is None


def test_gazetteer_year_for_boundary():
    assert gazetteer_year_for(2015) == 2019
    assert gazetteer_year_for(2019) == 2019
    assert gazetteer_year_for(2020) == 2023
    assert gazetteer_year_for(2022) == 2023


def test_aggregate_joins_groups_and_skips():
    # county 001 -> code 1, county 037 -> code 19
    lookup = {1: 1, 37: 19}
    gaz = {
        "06001400100": 1.0,
        "06001400200": 1.0,
        "06037900100": 2.0,
        # 06037900200 intentionally missing land area -> skipped
    }
    rows = [
        {"geoid": "06001400100", "pop": 1000},
        {"geoid": "06001400200", "pop": 3000},
        {"geoid": "06037900100", "pop": 500},
        {"geoid": "06037900200", "pop": 9999},  # no land area -> skipped
        {"geoid": "06099000100", "pop": 100},   # county 099 not in lookup -> skipped
    ]
    out = {r["county_code"]: r for r in aggregate_county_density(rows, gaz, lookup, 2022)}
    assert set(out) == {1, 19}
    assert out[1]["weighted_density"] == 2500.0
    assert out[1]["tract_count"] == 2
    assert out[1]["year"] == 2022
    assert out[19]["weighted_density"] == 250.0
    assert out[19]["tract_count"] == 1


def test_tract_density_job_registered():
    from etl.jobs import build_default_registry

    registry = build_default_registry()
    job = registry.get("tract_density")
    assert job.module == "etl.census_tract_density"
    assert job.table_name == "tract_density_county_year"


class TestLoudFailure:
    """Audit M8: same silent-green class as FARS, plus the unset-API-key case
    which returned success without loading anything."""

    def test_failing_years_raise(self, monkeypatch):
        import pytest
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from etl import _utils
        from etl import census_tract_density as mod

        monkeypatch.setattr(mod, "settings", SimpleNamespace(census_api_key="key"))
        db = MagicMock()
        db.query.return_value.all.return_value = []
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)
        monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
        from types import SimpleNamespace as _NS
        monkeypatch.setattr(_utils, "EtlRun", lambda **kw: _NS(**{"id": 1, "rows_loaded": None, **kw}))

        def boom(year):
            raise RuntimeError("census down")

        monkeypatch.setattr(mod, "gazetteer_year_for", boom)

        with pytest.raises(RuntimeError, match="failed"):
            mod.run(start_year=2020, end_year=2021)

    def test_missing_api_key_raises(self, monkeypatch):
        import pytest
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from etl import _utils
        from etl import census_tract_density as mod

        monkeypatch.setattr(mod, "settings", SimpleNamespace(census_api_key=""))
        monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
        from types import SimpleNamespace as _NS
        monkeypatch.setattr(_utils, "EtlRun", lambda **kw: _NS(**{"id": 1, "rows_loaded": None, **kw}))

        with pytest.raises(RuntimeError, match="CENSUS_API_KEY"):
            mod.run()

    def test_unpublished_vintage_404_skips_quietly(self, monkeypatch):
        import httpx
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from etl import _utils
        from etl import census_tract_density as mod

        monkeypatch.setattr(mod, "settings", SimpleNamespace(census_api_key="key"))
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

        monkeypatch.setattr(mod, "gazetteer_year_for", not_published)

        mod.run(start_year=2024, end_year=2024)


class TestPublishLagGuard:
    """Distinguish a malformed ACS response (raise) from a genuinely empty
    newest-vintage pull (legitimate publishing lag, log+skip) vs an empty
    OLDER year (real problem, raise)."""

    def test_non_list_response_raises(self, monkeypatch):
        """The ACS API returns a JSON error object (not a list) for a bad
        key or malformed query — that must fail loudly, not degrade to []."""
        from etl import census_tract_density as mod

        fake_resp = SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"error": "invalid key"},
        )
        monkeypatch.setattr(mod.httpx, "get", lambda *a, **kw: fake_resp)

        with pytest.raises(RuntimeError, match="unexpected response shape"):
            fetch_tract_population(2022, "fake-key")

    def test_well_formed_empty_list_returns_empty_without_raising(self, monkeypatch):
        from etl import census_tract_density as mod

        fake_resp = SimpleNamespace(raise_for_status=lambda: None, json=lambda: [])
        monkeypatch.setattr(mod.httpx, "get", lambda *a, **kw: fake_resp)

        assert fetch_tract_population(2022, "fake-key") == []

    def _patch_run(self, monkeypatch, *, period_already_loaded: bool = False):
        """period_already_loaded controls what the new
        require_rows_unless_new_period() existence check (a mocked
        db.execute(...).first()) reports for the year being fetched."""
        from etl import _utils
        from etl import census_tract_density as mod

        monkeypatch.setattr(mod, "settings", SimpleNamespace(census_api_key="key"))
        db = MagicMock()
        db.query.return_value.all.return_value = [SimpleNamespace(code=1, fips="06001")]
        db.execute.return_value.first.return_value = (
            (1,) if period_already_loaded else None
        )
        monkeypatch.setattr(mod, "SessionLocal", lambda: db)
        monkeypatch.setattr(mod, "fetch_gazetteer_land", lambda gaz_year: {"06001400100": 1.0})
        monkeypatch.setattr(_utils, "SessionLocal", lambda: MagicMock())
        monkeypatch.setattr(
            _utils, "EtlRun",
            lambda **kw: SimpleNamespace(**{"id": 1, "rows_loaded": None, **kw}),
        )
        return mod, db

    def test_empty_tract_rows_with_no_existing_rows_is_not_an_error(self, monkeypatch):
        mod, db = self._patch_run(monkeypatch, period_already_loaded=False)
        monkeypatch.setattr(mod, "fetch_tract_population", lambda year, key: [])

        mod.run(start_year=2022, end_year=2022)  # must not raise

    def test_empty_tract_rows_with_existing_rows_raises(self, monkeypatch):
        """A year we already have tract_density_county_year rows for going
        to zero is a real regression, regardless of whether it's the newest
        requested year (the old end_year-keyed carve-out could miss this on
        a manual backfill — Minor 4)."""
        mod, db = self._patch_run(monkeypatch, period_already_loaded=True)
        monkeypatch.setattr(mod, "fetch_tract_population", lambda year, key: [])

        with pytest.raises(RuntimeError, match=r"1 year\(s\) failed: \[2020\]"):
            mod.run(start_year=2020, end_year=2020)

    def test_valid_fixture_loads_normally(self, monkeypatch):
        mod, db = self._patch_run(monkeypatch)
        monkeypatch.setattr(
            mod, "fetch_tract_population",
            lambda year, key: [{"geoid": "06001400100", "pop": 1000}],
        )

        mod.run(start_year=2022, end_year=2022)  # must not raise

        assert db.execute.called
        assert db.commit.called
