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
