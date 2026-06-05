"""Integration tests for /api/pipeline/health and /api/pipeline/matviews."""

import pytest

pytestmark = pytest.mark.integration


def test_pipeline_health_returns_status(client):
    response = client.get("/api/pipeline/health")
    assert response.status_code == 200
    body = response.json()
    assert "status" in body
    assert body["status"] in ("healthy", "degraded", "unhealthy")


def test_pipeline_health_has_required_fields(client):
    response = client.get("/api/pipeline/health")
    body = response.json()
    expected_keys = {
        "status",
        "last_successful_run",
        "last_failed_run",
        "hours_since_success",
        "active_jobs",
        "recent_failure_rate",
        "db_size_mb",
        "matview_age_hours",
    }
    assert expected_keys.issubset(body.keys())


def test_pipeline_health_active_jobs_is_zero(client):
    response = client.get("/api/pipeline/health")
    body = response.json()
    assert body["active_jobs"] == 0


def test_pipeline_health_db_size_is_positive(client):
    response = client.get("/api/pipeline/health")
    body = response.json()
    assert body["db_size_mb"] is not None
    assert body["db_size_mb"] > 0


# --- GET /api/pipeline/matviews ---


def test_pipeline_matviews_returns_list(client):
    response = client.get("/api/pipeline/matviews")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) > 0


def test_pipeline_matviews_entry_shape(client):
    response = client.get("/api/pipeline/matviews")
    body = response.json()
    for entry in body:
        assert "name" in entry
        assert "row_count" in entry
