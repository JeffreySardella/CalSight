"""Unit tests for app/routers/clusters.py.

tests/api/test_clusters.py drives the real grid-aggregation SQL against a
seeded Postgres DB (marked `integration`). Here the z-score math in
`_compute_clusters` — the actual "is this a hotspot" logic — is tested
directly against canned grid rows, and the endpoint's TTL cache + filter
validation are tested through TestClient with `get_db` overridden.
"""

from collections import namedtuple
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.routers.clusters import (
    _clusters_cache,
    _compute_clusters,
    clear_clusters_cache,
)

_Row = namedtuple("_Row", "lat lng count fatal injury pdo")


@pytest.fixture(autouse=True)
def _fresh_cache():
    clear_clusters_cache()
    yield
    clear_clusters_cache()


class TestComputeClusters:
    def test_no_rows_yields_empty_response(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.group_by.return_value.all.return_value = []

        result = _compute_clusters(db, [])

        assert result.clusters == []
        assert result.total_grid_cells == 0
        assert result.mean_count == 0
        assert result.stddev_count == 0

    def test_uniform_counts_have_zero_stddev_and_no_clusters(self):
        # Every cell has the same count -> stddev is 0 -> nothing can exceed
        # the z-score threshold, regardless of how high the count is.
        rows = [_Row(34.0, -118.0, 100, 1, 2, 97), _Row(34.01, -118.0, 100, 0, 3, 97)]
        db = MagicMock()
        db.query.return_value.filter.return_value.group_by.return_value.all.return_value = rows

        result = _compute_clusters(db, [])

        assert result.stddev_count == 0
        assert result.clusters == []
        assert result.total_grid_cells == 2

    def test_outlier_cell_is_flagged_as_a_cluster(self):
        # Nine quiet cells (count=1) and one hot cell (count=50) — the hot
        # cell's z-score should clear the 2.0 threshold.
        rows = [_Row(34.0 + i * 0.01, -118.0, 1, 0, 0, 1) for i in range(9)]
        rows.append(_Row(35.0, -118.0, 50, 5, 10, 35))
        db = MagicMock()
        db.query.return_value.filter.return_value.group_by.return_value.all.return_value = rows

        result = _compute_clusters(db, [])

        assert result.total_grid_cells == 10
        assert len(result.clusters) == 1
        cluster = result.clusters[0]
        assert cluster.crash_count == 50
        assert cluster.z_score > 2.0
        assert cluster.severity.fatal == 5
        assert cluster.severity.injury == 10
        assert cluster.severity.pdo == 35

    def test_no_cell_exceeds_threshold_returns_no_clusters(self):
        rows = [_Row(34.0, -118.0, 5, 0, 1, 4), _Row(34.01, -118.0, 6, 0, 1, 5)]
        db = MagicMock()
        db.query.return_value.filter.return_value.group_by.return_value.all.return_value = rows

        result = _compute_clusters(db, [])

        assert result.clusters == []


class _FakeClusterQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *a, **k):
        return self

    def group_by(self, *a, **k):
        return self

    def all(self):
        return self._rows


@pytest.fixture()
def client_with():
    def _make(rows=()):
        db = MagicMock()
        db.query.return_value = _FakeClusterQuery(list(rows))
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app), db

    yield _make
    app.dependency_overrides.pop(get_db, None)


class TestClusterEndpoint:
    def test_no_filters_returns_shape(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/crashes/clusters")
        assert resp.status_code == 200
        body = resp.json()
        assert body["clusters"] == []
        assert body["total_grid_cells"] == 0

    def test_invalid_severity_is_422(self, client_with):
        client, _ = client_with([])
        resp = client.get("/api/crashes/clusters?severity=not-a-severity")
        assert resp.status_code == 422

    def test_second_identical_request_hits_cache(self, client_with):
        client, db = client_with([])
        r1 = client.get("/api/crashes/clusters?year=2023")
        assert r1.status_code == 200
        assert len(_clusters_cache) == 1
        assert db.query.call_count == 1

        # A cache hit must skip the grid-aggregation query entirely.
        r2 = client.get("/api/crashes/clusters?year=2023")
        assert r2.status_code == 200
        assert r2.json() == r1.json()
        assert db.query.call_count == 1

    def test_different_filters_are_separate_cache_entries(self, client_with):
        client, db = client_with([])
        client.get("/api/crashes/clusters?year=2022")
        client.get("/api/crashes/clusters?year=2023")
        assert len(_clusters_cache) == 2
        assert db.query.call_count == 2
