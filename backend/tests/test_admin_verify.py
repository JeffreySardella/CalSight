"""Unit tests for POST /api/admin/verify (issue #300 / #291).

These run without a database: the endpoint only compares the submitted key
against settings.effective_admin_key. settings is monkeypatched per test and
the router's rate limiter storage is reset so the 5/minute cap never bleeds
between tests.
"""

import pytest
from fastapi.testclient import TestClient

import app.routers.admin as admin_module
from app.main import app
from app.settings import settings


@pytest.fixture()
def client(monkeypatch):
    # Keep maintenance mode from short-circuiting requests, and reset the
    # in-memory rate-limit counters between tests.
    monkeypatch.setattr(settings, "maintenance_mode", False)
    admin_module._limiter.reset()
    return TestClient(app)


def test_valid_admin_key_returns_200(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_key", "admin-secret")
    monkeypatch.setattr(settings, "etl_api_key", "etl-secret")

    resp = client.post("/api/admin/verify", json={"key": "admin-secret"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_invalid_key_returns_403(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_key", "admin-secret")
    monkeypatch.setattr(settings, "etl_api_key", "etl-secret")

    resp = client.post("/api/admin/verify", json={"key": "wrong"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Invalid admin key"


def test_etl_key_rejected_when_distinct_admin_key_is_set(client, monkeypatch):
    """The whole point of the #300 split: the ETL secret must no longer
    unlock the admin UI once a dedicated admin key exists."""
    monkeypatch.setattr(settings, "admin_api_key", "admin-secret")
    monkeypatch.setattr(settings, "etl_api_key", "etl-secret")

    resp = client.post("/api/admin/verify", json={"key": "etl-secret"})
    assert resp.status_code == 403


def test_unconfigured_returns_503(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_key", "")
    monkeypatch.setattr(settings, "etl_api_key", "")

    resp = client.post("/api/admin/verify", json={"key": "anything"})
    assert resp.status_code == 503
    assert "not configured" in resp.json()["detail"]


def test_falls_back_to_etl_key_when_admin_key_unset(client, monkeypatch):
    """Backward compatibility: ADMIN_API_KEY empty -> ETL_API_KEY still works."""
    monkeypatch.setattr(settings, "admin_api_key", "")
    monkeypatch.setattr(settings, "etl_api_key", "etl-secret")

    resp = client.post("/api/admin/verify", json={"key": "etl-secret"})
    assert resp.status_code == 200

    resp = client.post("/api/admin/verify", json={"key": "not-the-etl-key"})
    assert resp.status_code == 403


def test_missing_key_field_is_a_422(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_key", "admin-secret")

    resp = client.post("/api/admin/verify", json={})
    assert resp.status_code == 422


def test_verify_endpoint_is_rate_limited():
    """Source-level guard (same style as test_etl_router_unit): brute-forcing
    the admin key must stay throttled at 5/minute."""
    import inspect

    src = inspect.getsource(admin_module.verify_admin_key)
    assert '@_limiter.limit("5/minute")' in src
