"""Integration tests for /api/water/snowpack."""

from datetime import date

import pytest

from app.models import SnowDaily, SnowStation

pytestmark = pytest.mark.integration


@pytest.fixture()
def snow_data(db_session):
    """Two regions. North (CSL) has 3 years of March-1 history: avg 10,
    latest 15 → 150% of average. South (BSH) has a single reading (no
    usable history)."""
    db_session.add_all([
        SnowStation(station_id="CSL", name="Central Sierra Snow Lab", elevation_ft=6900, region="Central Sierra"),
        SnowStation(station_id="BSH", name="Bishop Pass", elevation_ft=11200, region="Southern Sierra"),
    ])
    db_session.flush()
    db_session.add_all([
        SnowDaily(station_id="CSL", date=date(2024, 3, 1), swe_in=5.0),
        SnowDaily(station_id="CSL", date=date(2025, 3, 1), swe_in=10.0),
        SnowDaily(station_id="CSL", date=date(2026, 3, 1), swe_in=15.0),  # latest
        # An off-cycle reading that must not pollute the March-1 average.
        SnowDaily(station_id="CSL", date=date(2026, 2, 28), swe_in=99.0),
        SnowDaily(station_id="BSH", date=date(2026, 3, 1), swe_in=30.0),
    ])
    db_session.commit()
    return db_session


def test_snowpack_region_pct_of_same_day_average(client, snow_data):
    body = client.get("/api/water/snowpack").json()
    central = next(r for r in body["regions"] if r["region"] == "Central Sierra")
    assert central["latest_date"] == "2026-03-01"
    assert central["swe_in"] == 15.0
    assert central["avg_swe_in"] == pytest.approx(10.0)  # (5+10+15)/3
    assert central["pct_of_average"] == pytest.approx(150.0)
    assert central["station_count"] == 1


def test_snowpack_region_without_history_has_no_pct(client, snow_data):
    body = client.get("/api/water/snowpack").json()
    south = next(r for r in body["regions"] if r["region"] == "Southern Sierra")
    assert south["swe_in"] == 30.0
    assert south["pct_of_average"] is None
    assert south["avg_swe_in"] is None


def test_snowpack_statewide_only_counts_stations_with_history(client, snow_data):
    body = client.get("/api/water/snowpack").json()
    # Only CSL has history: 15 / 10 = 150%. BSH (no history) is excluded.
    assert body["statewide_pct_of_average"] == pytest.approx(150.0)
    assert body["latest_date"] == "2026-03-01"


def test_snowpack_regions_sorted(client, snow_data):
    regions = [r["region"] for r in client.get("/api/water/snowpack").json()["regions"]]
    assert regions == sorted(regions)


def test_snowpack_404_without_data(client):
    assert client.get("/api/water/snowpack").status_code == 404
