"""Integration tests for /api/crashes/clusters."""

from datetime import datetime
from unittest.mock import patch

import pytest

import app.routers.clusters as clusters_mod
from app.models import Crash
from app.routers.clusters import clear_clusters_cache

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _fresh_clusters_cache():
    """Cluster results are cached in-process on the filter tuple; tests seed
    different data into the same app, so start (and leave) each with a cold
    cache."""
    clear_clusters_cache()
    yield
    clear_clusters_cache()


def test_clusters_response_shape(client):
    response = client.get("/api/crashes/clusters")
    assert response.status_code == 200
    body = response.json()
    assert "clusters" in body
    assert "total_grid_cells" in body
    assert "mean_count" in body
    assert "stddev_count" in body
    assert "threshold" in body
    assert isinstance(body["clusters"], list)


def test_clusters_no_hotspots_in_seed_data(client):
    """Seed data has 5 crashes spread across distinct grid cells (stddev=0),
    so no cell can exceed mean + 2*stddev."""
    response = client.get("/api/crashes/clusters")
    assert response.status_code == 200
    body = response.json()
    assert body["clusters"] == []
    assert body["total_grid_cells"] == 5


def test_clusters_no_matching_crashes(client):
    response = client.get("/api/crashes/clusters?year=2001")
    assert response.status_code == 200
    body = response.json()
    assert body["clusters"] == []
    assert body["total_grid_cells"] == 0
    assert body["mean_count"] == 0
    assert body["stddev_count"] == 0


def test_clusters_cache_header(client):
    response = client.get("/api/crashes/clusters")
    assert response.headers.get("cache-control") == "public, max-age=3600, stale-while-revalidate=86400"


def test_clusters_rejects_unknown_county(client):
    response = client.get("/api/crashes/clusters?county=atlantis")
    assert response.status_code == 422
    assert response.json()["filter"] == "county"


def test_clusters_filter_by_severity_still_valid(client):
    response = client.get("/api/crashes/clusters?severity=fatal")
    assert response.status_code == 200
    body = response.json()
    assert body["total_grid_cells"] == 2  # crashes 1 (SWITRS) + 3 (CCRS)


def test_clusters_detects_hotspot(client, db_session):
    """Pack extra crashes into a single grid cell so it stands out (z > 2)
    against the sparse, single-crash-per-cell seed data."""
    extra = [
        Crash(
            id=100 + i, collision_id=9000 + i, data_source="ccrs",
            crash_datetime=datetime(2024, 5, 1, 10, 0), county_code=19,
            crash_year=2024, crash_hour=10, crash_month=5, day_of_week_num=2,
            severity="Fatal" if i < 3 else "Injury",
            canonical_cause="dui", number_killed=1 if i < 3 else 0, number_injured=0 if i < 3 else 1,
            county_name="Los Angeles", latitude=34.20, longitude=-118.20,
            is_alcohol_involved=True, is_distraction_involved=False,
        )
        for i in range(8)
    ]
    db_session.add_all(extra)
    db_session.commit()

    response = client.get("/api/crashes/clusters?year=2024")
    assert response.status_code == 200
    body = response.json()
    assert body["total_grid_cells"] == 1
    # A single grid cell can't have a nonzero stddev on its own, so widen the
    # filter to include the seed data's sparse cells alongside the packed one.
    response = client.get("/api/crashes/clusters")
    body = response.json()
    assert len(body["clusters"]) == 1
    cluster = body["clusters"][0]
    assert cluster["lat"] == 34.2
    assert cluster["lng"] == -118.2
    assert cluster["crash_count"] == 8
    assert cluster["z_score"] > 2
    assert cluster["severity"] == {"fatal": 3, "injury": 5, "pdo": 0}


def test_clusters_cached_within_ttl(client):
    """A repeat /crashes/clusters call with identical filters is served from the
    TTL cache without re-running the ~4.1M-row grid aggregation; a different
    filter tuple misses. Byte-identical result on the hit."""
    with patch.object(
        clusters_mod, "_compute_clusters", wraps=clusters_mod._compute_clusters
    ) as spy:
        first = client.get("/api/crashes/clusters").json()
        assert spy.call_count == 1
        second = client.get("/api/crashes/clusters").json()
        assert spy.call_count == 1  # cache hit — no second aggregation
        assert second == first
        # A different filter tuple is a cache miss and recomputes.
        client.get("/api/crashes/clusters?severity=fatal")
        assert spy.call_count == 2


def test_clusters_invalid_filter_not_cached(client):
    """An unknown county 422s and must never be cached — a repeat still 422s
    (the compute helper is never reached for it)."""
    with patch.object(
        clusters_mod, "_compute_clusters", wraps=clusters_mod._compute_clusters
    ) as spy:
        assert client.get("/api/crashes/clusters?county=atlantis").status_code == 422
        assert client.get("/api/crashes/clusters?county=atlantis").status_code == 422
        assert spy.call_count == 0
