import pytest

pytestmark = pytest.mark.integration


def test_etl_status_returns_sources(client):
    response = client.get("/api/etl/status")
    assert response.status_code == 200
    data = response.json()
    assert "sources" in data
    assert isinstance(data["sources"], list)
    assert len(data["sources"]) > 0
    source = data["sources"][0]
    assert "name" in source
    assert "schedule" in source
    assert "last_run" in source


def test_etl_run_history(client):
    response = client.get("/api/etl/runs?limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "runs" in data
    assert isinstance(data["runs"], list)


def test_etl_run_rejects_bad_key(client):
    response = client.post("/api/etl/run", headers={"X-ETL-API-KEY": "wrong-key"})
    assert response.status_code == 403


def test_etl_run_rejects_missing_key(client):
    response = client.post("/api/etl/run")
    assert response.status_code == 403
