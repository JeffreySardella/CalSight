"""Integration tests for /api/tract-burden."""

import pytest

from app.models import DataQualityStat, TractCes, TractCrashYear
from app.routers.tract_burden import clear_tract_burden_cache

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _no_cache():
    """The endpoint holds an in-process TTL cache; each test needs a cold one."""
    clear_tract_burden_cache()
    yield
    clear_tract_burden_cache()


def _seed(db_session):
    db_session.add_all([
        # Two LA tracts, one Orange tract. The Orange one has no crash rows
        # at all — it must still come back, with zeroes.
        TractCes(geoid="06037100100", county_code=19, ces_score=45.0,
                 ces_percentile=88.0, pollution_burden=60.0,
                 pop_characteristics=55.0, population=4000),
        TractCes(geoid="06037100200", county_code=19, ces_score=12.0,
                 ces_percentile=15.0, pollution_burden=20.0,
                 pop_characteristics=10.0, population=2000),
        TractCes(geoid="06059010100", county_code=30, ces_score=30.0,
                 ces_percentile=50.0, population=1000),
        # CES scored this tract but carried no population for it.
        TractCes(geoid="06037100300", county_code=19, ces_score=40.0,
                 ces_percentile=70.0, population=None),
    ])
    db_session.add_all([
        TractCrashYear(geoid="06037100100", year=2022, crash_count=10, killed=1, injured=4),
        TractCrashYear(geoid="06037100100", year=2023, crash_count=30, killed=2, injured=6),
        TractCrashYear(geoid="06037100200", year=2023, crash_count=5, killed=0, injured=1),
        # A year outside the window the tests ask for.
        TractCrashYear(geoid="06037100200", year=2019, crash_count=999, killed=99, injured=99),
        TractCrashYear(geoid="06037100300", year=2023, crash_count=7, killed=1, injured=2),
    ])
    db_session.add_all([
        # Statewide coverage rows (county_code NULL) — what coord_share reads.
        DataQualityStat(county_code=None, year=2022, total_crashes=1000,
                        crashes_with_coords=300, coords_pct=30.0),
        DataQualityStat(county_code=None, year=2023, total_crashes=1000,
                        crashes_with_coords=500, coords_pct=50.0),
        DataQualityStat(county_code=None, year=2019, total_crashes=1000,
                        crashes_with_coords=100, coords_pct=10.0),
    ])
    db_session.flush()


def test_sums_crash_years_within_the_window(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-burden?start=2022&end=2023").json()
    rows = {r["geoid"]: r for r in body["tracts"]}

    assert rows["06037100100"]["crash_count"] == 40   # 10 + 30
    assert rows["06037100100"]["killed"] == 3
    assert rows["06037100100"]["injured"] == 10
    # 2019 is outside the window and must not be summed in.
    assert rows["06037100200"]["crash_count"] == 5


def test_tracts_with_no_crashes_still_appear(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-burden?start=2022&end=2023").json()
    orange = next(r for r in body["tracts"] if r["geoid"] == "06059010100")

    assert orange["crash_count"] == 0
    assert orange["killed"] == 0
    assert orange["crashes_per_1k_pop"] == 0.0


def test_rate_uses_the_ces_tract_population(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-burden?start=2022&end=2023").json()
    rows = {r["geoid"]: r for r in body["tracts"]}

    # 40 crashes over 4,000 residents = 10 per 1,000.
    assert rows["06037100100"]["crashes_per_1k_pop"] == 10.0
    # 5 over 2,000 = 2.5 — the low-CES tract has the lower rate, which is the
    # whole point of dividing by population rather than mapping raw counts.
    assert rows["06037100200"]["crashes_per_1k_pop"] == 2.5
    assert body["summary"]["population_available"] is True


def test_summary_reports_coordinate_coverage_for_the_selected_years(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-burden?start=2022&end=2023").json()
    # (300 + 500) / (1000 + 1000) — the 10%-coverage 2019 row is excluded, so
    # the caption tracks the window the user actually selected.
    assert body["summary"]["coord_share"] == 0.4
    assert body["summary"]["start_year"] == 2022
    assert body["summary"]["end_year"] == 2023


def test_filters_by_county(client, db_session):
    _seed(db_session)
    body = client.get("/api/tract-burden?start=2022&end=2023&county=orange").json()

    assert [r["geoid"] for r in body["tracts"]] == ["06059010100"]
    assert body["summary"]["tract_count"] == 1


def test_sets_a_one_day_cache_header(client, db_session):
    _seed(db_session)
    resp = client.get("/api/tract-burden")
    assert resp.status_code == 200
    assert "max-age=86400" in resp.headers["Cache-Control"]


def test_unknown_county_slug_is_rejected(client, db_session):
    _seed(db_session)
    assert client.get("/api/tract-burden?county=atlantis").status_code == 422


def test_population_less_tract_reports_a_count_and_a_null_rate(client, db_session):
    """A tract CES has no population for must be distinguishable from one with
    no crashes: null rate, real count, and counted in the summary so the UI can
    label it instead of rendering it as a hole."""
    _seed(db_session)
    body = client.get("/api/tract-burden?start=2022&end=2023").json()
    row = next(r for r in body["tracts"] if r["geoid"] == "06037100300")

    assert row["crashes_per_1k_pop"] is None
    assert row["crash_count"] == 7
    assert row["killed"] == 1
    # Other tracts DO have populations, so the ramp stays a rate...
    assert body["summary"]["population_available"] is True
    # ...and the caller is told how many rows it cannot express in those units.
    assert body["summary"]["tracts_without_population"] == 1


def test_empty_tables_return_an_empty_payload_not_a_500(client, db_session):
    """The state prod is in between this merging and the manual first load."""
    resp = client.get("/api/tract-burden?start=2022&end=2023")

    assert resp.status_code == 200
    body = resp.json()
    assert body["tracts"] == []
    assert body["summary"]["tract_count"] == 0
    assert body["summary"]["population_available"] is False
    assert body["summary"]["tracts_without_population"] == 0


def test_repeat_request_is_served_from_the_ttl_cache(client, db_session):
    """Second call must not re-run the join — the response is ~1.2 MB."""
    _seed(db_session)
    first = client.get("/api/tract-burden?start=2022&end=2023").json()

    # Delete everything the query reads; a cache miss would now return zero
    # tracts, so an identical body proves the cached object came back.
    db_session.query(TractCrashYear).delete()
    db_session.query(TractCes).delete()
    db_session.flush()

    second = client.get("/api/tract-burden?start=2022&end=2023").json()
    assert second == first
    assert len(second["tracts"]) == 4

    # A different window is a different key, so it must miss and see the truth.
    assert client.get("/api/tract-burden?start=2023&end=2023").json()["tracts"] == []
