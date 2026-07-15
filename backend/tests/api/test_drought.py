"""Integration tests for the /api/water/drought endpoints."""

from datetime import date

import pytest

from app.models import DroughtCountyWeekly

pytestmark = pytest.mark.integration


@pytest.fixture()
def drought_data(db_session):
    """Two weeks of data for two seeded counties.

    Seed areas: Alameda (code 1) = 738 sq mi, Los Angeles (code 19)
    = 4058 sq mi — LA dominates any area-weighted statewide figure.
    """
    def week(county_code, week_start, none, d0, d1, d2, d3=0.0, d4=0.0):
        return DroughtCountyWeekly(
            county_code=county_code,
            week_start=week_start,
            none_pct=none,
            d0_pct=d0,
            d1_pct=d1,
            d2_pct=d2,
            d3_pct=d3,
            d4_pct=d4,
        )

    db_session.add_all([
        # Older week — both counties fully out of drought.
        week(1, date(2026, 6, 23), 100.0, 0.0, 0.0, 0.0),
        week(19, date(2026, 6, 23), 100.0, 0.0, 0.0, 0.0),
        # Latest week — Alameda clear, LA in deep drought.
        week(1, date(2026, 6, 30), 100.0, 0.0, 0.0, 0.0),
        week(19, date(2026, 6, 30), 0.0, 20.0, 30.0, 50.0),
    ])
    db_session.commit()
    return db_session


# --- /water/drought (snapshot) ---

def test_snapshot_returns_latest_week_only(client, drought_data):
    body = client.get("/api/water/drought").json()
    assert body["week_start"] == "2026-06-30"
    assert len(body["counties"]) == 2


def test_snapshot_statewide_is_area_weighted(client, drought_data):
    body = client.get("/api/water/drought").json()
    # d2: (738*0 + 4058*50) / 4796 ≈ 42.3 — NOT the unweighted 25.
    assert body["statewide"]["d2_pct"] == pytest.approx(42.3, abs=0.1)
    assert body["statewide"]["none_pct"] == pytest.approx(15.4, abs=0.1)


def test_snapshot_includes_county_breakdown(client, drought_data):
    body = client.get("/api/water/drought").json()
    la = next(c for c in body["counties"] if c["county_code"] == 19)
    assert la["d2_pct"] == 50.0


def test_snapshot_404_without_data(client):
    assert client.get("/api/water/drought").status_code == 404


# --- /water/drought/series ---

def test_series_oldest_first_and_weighted(client, drought_data):
    body = client.get("/api/water/drought/series").json()
    assert [p["week_start"] for p in body] == ["2026-06-23", "2026-06-30"]
    assert body[0]["none_pct"] == 100.0
    assert body[1]["d2_pct"] == pytest.approx(42.3, abs=0.1)


def test_series_weeks_param_limits_to_most_recent(client, drought_data):
    body = client.get("/api/water/drought/series?weeks=1").json()
    assert len(body) == 1
    # weeks=1 must return the NEWEST week, not the oldest.
    assert body[0]["week_start"] == "2026-06-30"


def test_series_rejects_out_of_range_weeks(client, drought_data):
    assert client.get("/api/water/drought/series?weeks=0").status_code == 422
