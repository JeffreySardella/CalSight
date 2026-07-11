import pytest

pytestmark = pytest.mark.integration


def test_admin_verify_post_invalid_key(client):
    response = client.post("/api/admin/verify", json={"key": "wrong"})
    assert response.status_code in (403, 503)


def test_admin_verify_post_missing_key(client):
    response = client.post("/api/admin/verify", json={})
    assert response.status_code == 422


def test_admin_verify_get_no_longer_works(client):
    response = client.get("/api/admin/verify?key=anything")
    assert response.status_code == 405


def test_admin_verify_is_explicitly_uncacheable(client):
    # (#291) auth verdicts must never be stored by any cache.
    response = client.post("/api/admin/verify", json={"key": "wrong"})
    assert response.headers.get("Cache-Control") == "no-store"
