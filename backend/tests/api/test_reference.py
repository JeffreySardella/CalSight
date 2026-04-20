"""Integration tests for reference endpoints."""

import pytest

pytestmark = pytest.mark.integration


# --- counties ---

def test_counties_returns_all_seeded(client):
    response = client.get("/api/counties")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    names = sorted(c["name"] for c in body)
    assert names == ["Alameda", "Los Angeles", "Orange", "Sacramento", "San Francisco"]


def test_counties_includes_geojson_by_default(client):
    response = client.get("/api/counties")
    body = response.json()
    assert all("geojson" in c for c in body)


def test_counties_can_omit_geojson(client):
    response = client.get("/api/counties?include_geojson=false")
    body = response.json()
    assert all(c.get("geojson") is None for c in body)


def test_counties_cache_header(client):
    response = client.get("/api/counties")
    assert response.headers.get("cache-control") == "public, max-age=3600"


# --- hospitals ---

def test_hospitals_lists_all(client):
    response = client.get("/api/hospitals")
    assert response.status_code == 200
    body = response.json()
    assert any(h["facility_name"] == "UCLA Medical" for h in body)


def test_hospitals_trauma_only_filters(client):
    response = client.get("/api/hospitals?trauma_only=true")
    body = response.json()
    assert all(h["trauma_center"] is not None for h in body)


def test_hospitals_county_filter(client):
    response = client.get("/api/hospitals?county=los-angeles")
    body = response.json()
    assert all(h["county_code"] == 19 for h in body)


# --- schools ---

def test_schools_paginated(client):
    response = client.get("/api/schools?limit=10")
    body = response.json()
    assert body["limit"] == 10
    assert body["offset"] == 0
    assert "items" in body
    assert body["total"] is None


def test_schools_include_total(client):
    response = client.get("/api/schools?limit=10&include_total=true")
    body = response.json()
    assert body["total"] is not None
    assert isinstance(body["total"], int)


def test_schools_school_type_filter(client):
    response = client.get("/api/schools?school_type=High")
    body = response.json()
    assert all(s["school_type"] == "High" for s in body["items"])


# --- calenviroscreen ---

def test_calenviroscreen_returns_rows(client):
    response = client.get("/api/calenviroscreen")
    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 1


def test_calenviroscreen_county_filter(client):
    response = client.get("/api/calenviroscreen?county=los-angeles")
    body = response.json()
    assert all(r["county_code"] == 19 for r in body)


# --- road-miles ---

def test_road_miles_returns_rows(client):
    response = client.get("/api/road-miles")
    body = response.json()
    assert isinstance(body, list)
    assert all("f_system" in r and "total_miles" in r for r in body)


def test_road_miles_f_system_filter(client):
    response = client.get("/api/road-miles?f_system=1")
    body = response.json()
    assert all(r["f_system"] == 1 for r in body)


# --- traffic-volumes ---

def test_traffic_volumes_returns_rows(client):
    response = client.get("/api/traffic-volumes")
    body = response.json()
    assert isinstance(body, list)
    assert all("total_aadt" in r for r in body)


# --- speed-limits ---

def test_speed_limits_returns_rows(client):
    response = client.get("/api/speed-limits")
    body = response.json()
    assert isinstance(body, list)
    assert all("speed_limit" in r for r in body)
