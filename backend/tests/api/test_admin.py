import os
import pytest

pytestmark = pytest.mark.integration


def test_admin_verify_post_valid_key(client):
    key = os.environ.get("ETL_API_KEY", "test-key")
    response = client.post("/api/admin/verify", json={"key": key})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_admin_verify_post_invalid_key(client):
    response = client.post("/api/admin/verify", json={"key": "wrong"})
    assert response.status_code == 403


def test_admin_verify_post_missing_key(client):
    response = client.post("/api/admin/verify", json={})
    assert response.status_code == 422


def test_admin_verify_get_no_longer_works(client):
    response = client.get("/api/admin/verify?key=anything")
    assert response.status_code == 405
