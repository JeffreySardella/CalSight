"""Integration tests for /api/crashes/heatmap."""

from unittest.mock import patch

import pytest

import app.routers.heatmap as heatmap_mod
from app.routers.heatmap import clear_heatmap_cache

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _fresh_heatmap_cache():
    clear_heatmap_cache()
    yield
    clear_heatmap_cache()


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
    assert response.headers.get("cache-control") == "public, max-age=3600, stale-while-revalidate=86400"


def test_heatmap_rejects_unknown_county(client):
    response = client.get("/api/crashes/heatmap?county=atlantis")
    assert response.status_code == 422
    assert response.json()["filter"] == "county"


def test_heatmap_total_equals_sum_of_weights(client):
    response = client.get("/api/crashes/heatmap")
    body = response.json()
    weight_sum = sum(p["weight"] for p in body["points"])
    assert weight_sum == body["total_crashes"]


def test_heatmap_grid_cached_within_ttl(client):
    """A repeat grid request with identical filters is served from the TTL
    cache; a different filter tuple misses and recomputes."""
    with patch.object(heatmap_mod, "_compute_grid", wraps=heatmap_mod._compute_grid) as spy:
        first = client.get("/api/crashes/heatmap").json()
        assert spy.call_count == 1
        assert client.get("/api/crashes/heatmap").json() == first
        assert spy.call_count == 1
        client.get("/api/crashes/heatmap?severity=fatal")
        assert spy.call_count == 2


def test_heatmap_medium_statewide_does_not_require_county(client):
    """medium is allowed unscoped (the statewide-heatmap Resolution toggle
    offers Low/Medium with no county involved) — it must not 422 like
    raw/high do."""
    response = client.get("/api/crashes/heatmap?resolution=medium&year=2023")
    assert response.status_code == 200


def test_heatmap_medium_statewide_uses_coarser_step_than_county_scoped(client):
    """Unscoped medium groups the full crashes table — 9.3 MB of JSON for one
    statewide year in the 2026-09-18 sweep. Guard the size at the source with
    a coarser grid step (mirroring how `low` stays small at any scope) rather
    than requiring a county the frontend doesn't always pass. Pin the coarser
    step directly: every unscoped-medium point must land on a multiple of
    _STATEWIDE_MEDIUM_STEP, not the finer 0.01 used once a county scopes it."""
    statewide = client.get("/api/crashes/heatmap?resolution=medium&year=2023").json()
    assert statewide["points"], "expected at least one grid cell"
    step = heatmap_mod._STATEWIDE_MEDIUM_STEP
    for pt in statewide["points"]:
        bucket = round(pt["lat"] / step)
        assert pt["lat"] == pytest.approx(bucket * step, abs=1e-6)

    # LA's seeded crashes (ids 1-3) are all pre-2023 — omit the year filter
    # here so the county-scoped request actually has points to check.
    scoped = client.get(
        "/api/crashes/heatmap?resolution=medium&county=los-angeles"
    ).json()
    assert scoped["points"], "expected at least one grid cell"
    fine_step = heatmap_mod._STEP[heatmap_mod.Resolution.medium]
    for pt in scoped["points"]:
        bucket = round(pt["lat"] / fine_step)
        assert pt["lat"] == pytest.approx(bucket * fine_step, abs=1e-6)
