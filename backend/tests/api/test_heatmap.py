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
