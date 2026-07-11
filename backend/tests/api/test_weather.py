"""Integration tests for /api/weather — incl. opt-in pagination (#291)."""

import pytest

from app.models import Weather

pytestmark = pytest.mark.integration


def _seed_weather(db_session, months=(1, 2, 3, 4)):
    db_session.add_all([
        Weather(county_code=19, year=2023, month=m,
                avg_temp_f=60.0 + m, precipitation_in=0.5 * m)
        for m in months
    ])
    db_session.flush()


def test_weather_default_returns_full_set(client, db_session):
    # Frontend (useCorrelationData) fetches /api/weather with no params and
    # expects everything — the default must stay uncapped.
    _seed_weather(db_session)
    body = client.get("/api/weather").json()
    assert len(body) == 4


def test_weather_pagination_slices_ordered_rows(client, db_session):
    _seed_weather(db_session)
    full = client.get("/api/weather?county=los-angeles").json()
    page = client.get("/api/weather?county=los-angeles&limit=2&offset=1").json()
    assert page == full[1:3]


def test_weather_offset_beyond_end_returns_empty(client, db_session):
    _seed_weather(db_session)
    body = client.get("/api/weather?offset=100").json()
    assert body == []


def test_weather_rejects_bad_limit(client):
    assert client.get("/api/weather?limit=0").status_code == 422
    assert client.get("/api/weather?offset=-1").status_code == 422
