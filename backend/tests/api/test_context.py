"""Integration tests for context endpoints."""

import pytest

pytestmark = pytest.mark.integration


# --- unemployment ---

def test_unemployment_returns_rows(client):
    response = client.get("/api/unemployment?county=los-angeles&year=2023")
    assert response.status_code == 200
    body = response.json()
    assert any(r["unemployment_rate"] == 4.7 for r in body)


def test_unemployment_field_name_preserved(client):
    response = client.get("/api/unemployment?county=los-angeles")
    body = response.json()
    assert all("unemployment_rate" in r for r in body)


# --- vehicles ---

def test_vehicles_returns_rows(client):
    response = client.get("/api/vehicles?county=los-angeles&year=2023")
    body = response.json()
    assert any(r["ev_vehicles"] == 310000 for r in body)


# --- licensed-drivers ---

def test_licensed_drivers_returns_rows(client):
    response = client.get("/api/licensed-drivers?county=los-angeles&year=2023")
    body = response.json()
    assert any(r["driver_count"] == 5800000 for r in body)


# --- data-quality ---

def test_data_quality_specific_county_year(client):
    response = client.get("/api/data-quality?county=los-angeles&year=2023")
    body = response.json()
    assert any(r["county_code"] == 19 and r["year"] == 2023 for r in body)


def test_data_quality_county_only_returns_all_time(client):
    response = client.get("/api/data-quality?county=los-angeles")
    body = response.json()
    assert all(r["county_code"] == 19 and r["year"] is None for r in body)


def test_data_quality_no_filter_returns_all(client):
    response = client.get("/api/data-quality")
    body = response.json()
    assert len(body) >= 2


# --- insights ---

def test_insights_empty_until_68(client):
    response = client.get("/api/insights")
    assert response.status_code == 200
    assert response.json() == []


# --- pagination (#291): limit/offset on unemployment + vehicles ---
# Default (no limit) must return the FULL set — the frontend fetches these
# endpoints unpaginated and would silently lose rows with a capped default.

def test_unemployment_pagination_slices_ordered_rows(client, db_session):
    from app.models import UnemploymentRate

    db_session.add_all([
        UnemploymentRate(county_code=19, year=2022, month=m, unemployment_rate=4.0 + m)
        for m in (1, 2, 3)
    ])
    db_session.flush()

    full = client.get("/api/unemployment?county=los-angeles").json()
    assert len(full) >= 4  # 3 new + 1 seeded

    page = client.get("/api/unemployment?county=los-angeles&limit=2&offset=1").json()
    assert page == full[1:3]


def test_unemployment_default_returns_full_set(client, db_session):
    from app.models import UnemploymentRate

    db_session.add_all([
        UnemploymentRate(county_code=1, year=2021, month=m, unemployment_rate=5.0)
        for m in range(1, 13)
    ])
    db_session.flush()

    body = client.get("/api/unemployment?county=alameda&year=2021").json()
    assert len(body) == 12  # no implicit cap


def test_unemployment_rejects_bad_limit(client):
    assert client.get("/api/unemployment?limit=0").status_code == 422
    assert client.get("/api/unemployment?offset=-1").status_code == 422


def test_vehicles_pagination_slices_ordered_rows(client, db_session):
    from app.models import VehicleRegistration

    db_session.add_all([
        VehicleRegistration(county_code=19, year=y, total_vehicles=1000 * y, ev_vehicles=y)
        for y in (2020, 2021, 2022)
    ])
    db_session.flush()

    full = client.get("/api/vehicles?county=los-angeles").json()
    assert len(full) >= 4  # 3 new + 1 seeded

    page = client.get("/api/vehicles?county=los-angeles&limit=2&offset=1").json()
    assert page == full[1:3]


def test_vehicles_default_returns_full_set(client):
    # The seeded row must come back with no params at all (frontend contract).
    body = client.get("/api/vehicles").json()
    assert any(r["ev_vehicles"] == 310000 for r in body)
