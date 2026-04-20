"""Integration tests for /api/demographics."""

import pytest

pytestmark = pytest.mark.integration


def test_demographics_returns_seeded(client):
    response = client.get("/api/demographics")
    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 2


def test_demographics_county_filter(client):
    response = client.get("/api/demographics?county=los-angeles")
    body = response.json()
    assert all(r["county_code"] == 19 for r in body)


def test_demographics_year_filter(client):
    response = client.get("/api/demographics?year=2023")
    body = response.json()
    assert all(r["year"] == 2023 for r in body)


def test_demographics_cache_header(client):
    response = client.get("/api/demographics")
    assert response.headers.get("cache-control") == "public, max-age=300"
