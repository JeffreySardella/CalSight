"""Integration tests for /api/pipeline/health and /api/pipeline/matviews."""

import pytest

pytestmark = pytest.mark.integration

_TEST_ETL_KEY = "test-etl-key-for-ci"


@pytest.fixture(autouse=True)
def _set_etl_key(monkeypatch):
    monkeypatch.setattr("app.settings.settings.etl_api_key", _TEST_ETL_KEY)


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


def test_pipeline_health_db_size_hidden_from_anonymous(client):
    # db_size_mb is infrastructure metadata; the public health endpoint (which
    # uptime monitors poll unauthenticated) must not leak it.
    response = client.get("/api/pipeline/health")
    body = response.json()
    assert body["db_size_mb"] is None


def test_pipeline_health_db_size_shown_to_authed_caller(client):
    response = client.get(
        "/api/pipeline/health", headers={"X-ETL-API-KEY": _TEST_ETL_KEY}
    )
    body = response.json()
    assert body["db_size_mb"] is not None
    assert body["db_size_mb"] > 0


def test_pipeline_health_db_size_hidden_for_wrong_key(client):
    response = client.get(
        "/api/pipeline/health", headers={"X-ETL-API-KEY": "wrong-key"}
    )
    body = response.json()
    assert body["db_size_mb"] is None
    # A wrong key must not turn the public health check into a 403 — it just
    # doesn't unlock the extra field.
    assert response.status_code == 200


# --- GET /api/pipeline/matviews ---


def test_pipeline_matviews_returns_list(client):
    response = client.get("/api/pipeline/matviews", headers={"X-ETL-API-KEY": _TEST_ETL_KEY})
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) > 0


def test_pipeline_matviews_entry_shape(client):
    response = client.get("/api/pipeline/matviews", headers={"X-ETL-API-KEY": _TEST_ETL_KEY})
    body = response.json()
    for entry in body:
        assert "name" in entry
        assert "row_count" in entry


def test_pipeline_matviews_rejects_without_key(client):
    response = client.get("/api/pipeline/matviews")
    assert response.status_code in (403, 503)


def test_pipeline_health_is_explicitly_uncacheable(client):
    # (#291) monitors must always see the live verdict — never a stored one.
    response = client.get("/api/pipeline/health")
    assert response.headers.get("Cache-Control") == "no-store"


def test_pipeline_matviews_is_explicitly_uncacheable(client):
    response = client.get(
        "/api/pipeline/matviews", headers={"X-ETL-API-KEY": _TEST_ETL_KEY}
    )
    assert response.headers.get("Cache-Control") == "no-store"
