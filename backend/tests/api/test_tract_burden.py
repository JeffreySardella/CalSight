"""Integration tests for /api/tract-burden."""

import pytest

from app.models import DataQualityStat, TractCes, TractCrashYear

pytestmark = pytest.mark.integration


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
    ])
    db_session.add_all([
        TractCrashYear(geoid="06037100100", year=2022, crash_count=10, killed=1, injured=4),
        TractCrashYear(geoid="06037100100", year=2023, crash_count=30, killed=2, injured=6),
        TractCrashYear(geoid="06037100200", year=2023, crash_count=5, killed=0, injured=1),
        # A year outside the window the tests ask for.
        TractCrashYear(geoid="06037100200", year=2019, crash_count=999, killed=99, injured=99),
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
