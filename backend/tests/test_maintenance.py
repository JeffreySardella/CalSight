"""Tests for maintenance mode — 503 + Retry-After when MAINTENANCE_MODE is on.

The middleware short-circuits before any route/DB work, so these run without a
database. settings.maintenance_mode is toggled via monkeypatch.
"""

from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app


def test_maintenance_blocks_api_requests(monkeypatch):
    monkeypatch.setattr(main_module.settings, "maintenance_mode", True)
    client = TestClient(app)

    resp = client.get("/api/__unknown_probe")
    assert resp.status_code == 503
    assert resp.json()["status"] == "maintenance"
    assert resp.headers.get("Retry-After") == "120"


def test_maintenance_health_reports_status(monkeypatch):
    """/api/health is exempt from the 503 block but reports the maintenance state."""
    monkeypatch.setattr(main_module.settings, "maintenance_mode", True)
    client = TestClient(app)

    resp = client.get("/api/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "maintenance"


def test_middleware_transparent_when_disabled(monkeypatch):
    """When off, the middleware passes through — an unknown path 404s, not 503s."""
    monkeypatch.setattr(main_module.settings, "maintenance_mode", False)
    client = TestClient(app)

    resp = client.get("/api/__definitely_not_a_route")
    assert resp.status_code == 404
