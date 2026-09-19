"""The /api/fog-days TTL cache: one scan per (county, year) per TTL window.

Unfiltered, this endpoint groups a large fraction of the 11M-row crashes table
live. Without a server-side cache every cold visitor paid that scan and held a
pooled connection for up to the 30s statement timeout. These tests pin the
cache down at the seam that matters — whether build_fog_days runs at all — so
no database is needed.
"""

import time

import pytest

from app.routers import fog_days


@pytest.fixture(autouse=True)
def _clean_cache():
    fog_days.clear_fog_cache()
    yield
    fog_days.clear_fog_cache()


@pytest.fixture()
def calls(monkeypatch):
    """Replace build_fog_days with a counter; the DB is never touched."""
    seen = []

    def fake(db, county, year):
        seen.append((county, year))
        return {"county": county, "year": year}

    monkeypatch.setattr(fog_days, "build_fog_days", fake)
    return seen


def test_a_second_identical_call_does_not_hit_the_database(calls):
    first = fog_days._cached_fog_days(None, None, None)
    second = fog_days._cached_fog_days(None, None, None)

    assert len(calls) == 1, "the second request recomputed instead of using the cache"
    assert second is first, "a hit must return the cached object, not a rebuild"


def test_a_different_county_or_year_is_computed_separately(calls):
    fog_days._cached_fog_days(None, "fresno", None)
    fog_days._cached_fog_days(None, "kern", None)
    fog_days._cached_fog_days(None, "fresno", 2024)

    assert calls == [("fresno", None), ("kern", None), ("fresno", 2024)]


def test_the_county_key_is_normalized(calls):
    """?county=Fresno and ?county=fresno are the same query, so one entry."""
    fog_days._cached_fog_days(None, "fresno", None)
    fog_days._cached_fog_days(None, "  Fresno ", None)

    assert len(calls) == 1


def test_an_expired_entry_is_recomputed(calls, monkeypatch):
    fog_days._cached_fog_days(None, None, None)
    # Jump past the TTL rather than sleeping through it.
    real = time.monotonic
    monkeypatch.setattr(
        fog_days.time, "monotonic", lambda: real() + fog_days._FOG_TTL_SECONDS + 1,
    )

    fog_days._cached_fog_days(None, None, None)

    assert len(calls) == 2


def test_clear_fog_cache_forces_a_recompute(calls):
    fog_days._cached_fog_days(None, None, None)
    fog_days.clear_fog_cache()
    fog_days._cached_fog_days(None, None, None)

    assert len(calls) == 2


def test_an_unknown_slug_still_raises_rather_than_caching_a_result(monkeypatch):
    """A miss goes through build_fog_days, so FilterError propagates as before
    and nothing is stored for the bad key."""
    def boom(db, county, year):
        raise fog_days.FilterError("unknown county", "county")

    monkeypatch.setattr(fog_days, "build_fog_days", boom)

    with pytest.raises(fog_days.FilterError):
        fog_days._cached_fog_days(None, "not-a-county", None)
    assert fog_days._fog_cache == {}


def test_the_cache_is_bounded(calls):
    """An unbounded dict keyed on user input is a slow memory leak."""
    for year in range(2001, 2001 + fog_days._FOG_CACHE_MAX + 5):
        fog_days._cached_fog_days(None, None, year)

    assert len(fog_days._fog_cache) <= fog_days._FOG_CACHE_MAX
