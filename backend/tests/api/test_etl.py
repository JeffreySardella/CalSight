import pytest

pytestmark = pytest.mark.integration


def test_etl_status_requires_auth(client):
    response = client.get("/api/etl/status")
    assert response.status_code in (403, 503)


def test_etl_runs_requires_auth(client):
    response = client.get("/api/etl/runs?limit=5")
    assert response.status_code in (403, 503)


def test_etl_run_rejects_bad_key(client):
    response = client.post("/api/etl/run", headers={"X-ETL-API-KEY": "wrong-key"})
    assert response.status_code in (403, 503)


def test_etl_run_rejects_missing_key(client):
    response = client.post("/api/etl/run")
    assert response.status_code in (403, 503)
