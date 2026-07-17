"""Integration tests for /api/water/precip (Sierra precipitation indices)."""

from datetime import date

import pytest

from app.models import PrecipIndexDaily

pytestmark = pytest.mark.integration


@pytest.fixture()
def precip_data(db_session):
    """8SI has 3 years of Jan-15 history (avg 40, latest 60 → 150%). 5SI has a
    single reading (no usable history)."""
    db_session.add_all([
        PrecipIndexDaily(station_id="8SI", date=date(2024, 1, 15), accum_in=20.0),
        PrecipIndexDaily(station_id="8SI", date=date(2025, 1, 15), accum_in=40.0),
        PrecipIndexDaily(station_id="8SI", date=date(2026, 1, 15), accum_in=60.0),  # latest
        # An off-cycle reading that must not pollute the Jan-15 average.
        PrecipIndexDaily(station_id="8SI", date=date(2026, 1, 10), accum_in=55.0),
        PrecipIndexDaily(station_id="5SI", date=date(2026, 1, 15), accum_in=34.0),
    ])
    db_session.commit()
    return db_session


def test_precip_index_pct_of_same_day_average(client, precip_data):
    body = client.get("/api/water/precip").json()
    north = next(r for r in body if r["station_id"] == "8SI")
    assert north["region"] == "Northern Sierra (8-Station)"
    assert north["latest_date"] == "2026-01-15"
    assert north["accum_in"] == pytest.approx(60.0)
    assert north["avg_accum_in"] == pytest.approx(40.0)  # (20+40+60)/3
    assert north["pct_of_average"] == pytest.approx(150.0)


def test_precip_index_without_history_has_no_pct(client, precip_data):
    body = client.get("/api/water/precip").json()
    sj = next(r for r in body if r["station_id"] == "5SI")
    assert sj["accum_in"] == pytest.approx(34.0)
    assert sj["pct_of_average"] is None
    assert sj["avg_accum_in"] is None


def test_precip_excludes_stale_index(client, db_session):
    """An index whose feed died years ago must not appear with a stale value."""
    db_session.add_all([
        PrecipIndexDaily(station_id="8SI", date=date(2026, 1, 15), accum_in=60.0),
        # 6SI last reported in 2019 — far outside the recency window.
        PrecipIndexDaily(station_id="6SI", date=date(2019, 1, 15), accum_in=25.0),
    ])
    db_session.commit()

    body = client.get("/api/water/precip").json()
    ids = {r["station_id"] for r in body}
    assert "8SI" in ids
    assert "6SI" not in ids


def test_precip_404_without_data(client):
    assert client.get("/api/water/precip").status_code == 404
