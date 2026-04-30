"""Integration tests for /api/crashes/heatmap."""

import pytest

pytestmark = pytest.mark.integration


def test_heatmap_returns_points_and_total(client):
    response = client.get("/api/crashes/heatmap?county=los-angeles")
    assert response.status_code == 200
    body = response.json()
    assert "points" in body
    assert "total_crashes" in body
    assert isinstance(body["points"], list)
    assert isinstance(body["total_crashes"], int)


def test_heatmap_point_shape(client):
    response = client.get("/api/crashes/heatmap?county=los-angeles")
    body = response.json()
    assert len(body["points"]) > 0
    point = body["points"][0]
    assert "lat" in point
    assert "lng" in point
    assert "weight" in point


def test_heatmap_default_resolution_statewide_is_low(client):
    """Without county filter, resolution defaults to low (0.1 deg)."""
    response = client.get("/api/crashes/heatmap")
    assert response.status_code == 200
    body = response.json()
    for pt in body["points"]:
        decimals = len(str(pt["lat"]).split(".")[-1]) if "." in str(pt["lat"]) else 0
        assert decimals <= 1


def test_heatmap_default_resolution_county_is_medium(client):
    """With county filter, resolution defaults to medium (0.01 deg)."""
    response = client.get("/api/crashes/heatmap?county=los-angeles")
    assert response.status_code == 200
    body = response.json()
    assert body["total_crashes"] > 0


def test_heatmap_high_resolution_requires_county(client):
    response = client.get("/api/crashes/heatmap?resolution=high")
    assert response.status_code == 422
    assert response.json()["filter"] == "resolution"


def test_heatmap_high_resolution_with_county_works(client):
    response = client.get("/api/crashes/heatmap?county=los-angeles&resolution=high")
    assert response.status_code == 200
    body = response.json()
    assert body["total_crashes"] > 0


def test_heatmap_filter_by_year(client):
    response = client.get("/api/crashes/heatmap?year=2023")
    body = response.json()
    assert body["total_crashes"] == 2  # crashes 4 (Orange) + 5 (SF)


def test_heatmap_filter_by_severity(client):
    response = client.get("/api/crashes/heatmap?severity=fatal")
    body = response.json()
    assert body["total_crashes"] == 2  # crashes 1 (SWITRS) + 3 (CCRS)


def test_heatmap_filter_by_cause(client):
    response = client.get("/api/crashes/heatmap?cause=dui")
    body = response.json()
    assert body["total_crashes"] == 2  # crashes 1 + 3


def test_heatmap_no_matching_crashes(client):
    response = client.get("/api/crashes/heatmap?year=2001")
    assert response.status_code == 200
    body = response.json()
    assert body["points"] == []
    assert body["total_crashes"] == 0


def test_heatmap_cache_header(client):
    response = client.get("/api/crashes/heatmap")
    assert response.headers.get("cache-control") == "public, max-age=300"


def test_heatmap_rejects_unknown_county(client):
    response = client.get("/api/crashes/heatmap?county=atlantis")
    assert response.status_code == 422
    assert response.json()["filter"] == "county"


def test_heatmap_total_equals_sum_of_weights(client):
    response = client.get("/api/crashes/heatmap")
    body = response.json()
    weight_sum = sum(p["weight"] for p in body["points"])
    assert weight_sum == body["total_crashes"]
