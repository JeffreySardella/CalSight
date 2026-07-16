"""Integration tests for the /api/water endpoints."""

from datetime import date

import pytest

from app.models import Reservoir, ReservoirDaily

pytestmark = pytest.mark.integration


@pytest.fixture()
def water_data(db_session):
    """Two reservoirs: Folsom with 3 years of history on July 1,
    Castaic with a single reading (no meaningful history)."""
    db_session.add_all([
        Reservoir(
            station_id="FOL", name="Folsom Lake", capacity_af=977_000,
            county_code=34, lat=38.683, lon=-121.183,
        ),
        # CAS deliberately has no coordinates — rows loaded before the
        # lat/lon columns existed look like this until the ETL reruns.
        Reservoir(station_id="CAS", name="Castaic Lake", capacity_af=325_000, county_code=19),
    ])
    db_session.flush()
    db_session.add_all([
        # Folsom: same day-of-year across 3 years → avg = 700k, latest = 800k
        ReservoirDaily(station_id="FOL", date=date(2024, 7, 1), storage_af=600_000),
        ReservoirDaily(station_id="FOL", date=date(2025, 7, 1), storage_af=700_000),
        ReservoirDaily(station_id="FOL", date=date(2026, 7, 1), storage_af=800_000),
        # An off-cycle reading that must not pollute the July 1 average
        ReservoirDaily(station_id="FOL", date=date(2026, 6, 30), storage_af=810_000),
        ReservoirDaily(station_id="CAS", date=date(2026, 7, 1), storage_af=260_000),
    ])
    db_session.commit()
    return db_session


# --- /water/reservoirs ---

def test_reservoirs_latest_reading_and_pct_capacity(client, water_data):
    body = client.get("/api/water/reservoirs").json()
    fol = next(r for r in body if r["station_id"] == "FOL")
    assert fol["latest_date"] == "2026-07-01"
    assert fol["storage_af"] == 800_000
    assert fol["pct_of_capacity"] == pytest.approx(81.9, abs=0.1)


def test_reservoirs_historical_average_same_day_of_year(client, water_data):
    fol = next(
        r for r in client.get("/api/water/reservoirs").json()
        if r["station_id"] == "FOL"
    )
    assert fol["avg_storage_af"] == pytest.approx(700_000)
    assert fol["pct_of_average"] == pytest.approx(114.3, abs=0.1)


def test_reservoirs_average_shown_for_constant_pool(client, water_data, db_session):
    # A regulated reservoir holding the exact same storage across years must
    # still report its average — "one year only" is detected by row count,
    # not value equality.
    db_session.add_all([
        ReservoirDaily(station_id="CAS", date=date(2025, 7, 1), storage_af=260_000),
    ])
    db_session.commit()
    cas = next(
        r for r in client.get("/api/water/reservoirs").json()
        if r["station_id"] == "CAS"
    )
    assert cas["avg_storage_af"] == pytest.approx(260_000)
    assert cas["pct_of_average"] == pytest.approx(100.0)


def test_reservoirs_no_average_without_history(client, water_data):
    cas = next(
        r for r in client.get("/api/water/reservoirs").json()
        if r["station_id"] == "CAS"
    )
    assert cas["avg_storage_af"] is None
    assert cas["pct_of_average"] is None


def test_reservoirs_include_coordinates_when_loaded(client, water_data):
    # The map layer needs lat/lon; a reservoir loaded before the coordinate
    # columns existed returns None (and the layer skips it) rather than 500ing.
    body = client.get("/api/water/reservoirs").json()
    fol = next(r for r in body if r["station_id"] == "FOL")
    cas = next(r for r in body if r["station_id"] == "CAS")
    assert fol["lat"] == pytest.approx(38.683)
    assert fol["lon"] == pytest.approx(-121.183)
    assert cas["lat"] is None
    assert cas["lon"] is None


def test_reservoirs_sorted_by_capacity(client, water_data):
    body = client.get("/api/water/reservoirs").json()
    capacities = [r["capacity_af"] for r in body]
    assert capacities == sorted(capacities, reverse=True)


def test_reservoirs_empty_db_returns_empty_list(client):
    assert client.get("/api/water/reservoirs").json() == []


def test_reservoirs_stale_station_omitted(client, water_data, db_session):
    # A station whose feed died must not contribute a months-old reading to
    # "current" conditions (mirrors the snowpack recency cutoff).
    db_session.add(
        Reservoir(station_id="DED", name="Dead Feed Lake", capacity_af=100_000, county_code=1)
    )
    db_session.flush()
    db_session.add(
        ReservoirDaily(station_id="DED", date=date(2026, 1, 1), storage_af=50_000)
    )
    db_session.commit()
    ids = [r["station_id"] for r in client.get("/api/water/reservoirs").json()]
    assert "DED" not in ids
    assert {"FOL", "CAS"} <= set(ids)


# --- /water/reservoirs/{station_id}/series ---

def test_series_returns_ordered_points(client, water_data):
    body = client.get("/api/water/reservoirs/FOL/series?start=2024-01-01").json()
    assert body["name"] == "Folsom Lake"
    dates = [p["date"] for p in body["points"]]
    assert dates == sorted(dates)
    assert len(dates) == 4


def test_series_defaults_to_trailing_year(client, water_data):
    # With no explicit start, the window is the year before `end` (or today)
    # — a backfilled station must not ship its whole multi-decade history.
    body = client.get("/api/water/reservoirs/FOL/series?end=2026-12-31").json()
    dates = [p["date"] for p in body["points"]]
    assert dates == ["2026-06-30", "2026-07-01"]


def test_series_window_filters(client, water_data):
    body = client.get(
        "/api/water/reservoirs/FOL/series?start=2026-01-01&end=2026-12-31"
    ).json()
    assert len(body["points"]) == 2


def test_series_station_id_case_insensitive(client, water_data):
    assert client.get("/api/water/reservoirs/fol/series").status_code == 200


def test_series_unknown_station_404(client, water_data):
    assert client.get("/api/water/reservoirs/NOPE/series").status_code == 404
