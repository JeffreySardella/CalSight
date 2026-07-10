"""Tests for /api/health rebuilding detection (mv_crashes_wide etc.)."""

import pytest
from sqlalchemy import text

import app.main as main_module
from app.health import is_rebuilding

pytestmark = pytest.mark.integration


def test_is_rebuilding_true_when_view_unpopulated(db_session):
    # A throwaway matview created WITH NO DATA is unpopulated.
    db_session.execute(text("CREATE MATERIALIZED VIEW mv_probe_unpop AS SELECT 1 AS x WITH NO DATA"))
    assert is_rebuilding(db_session, views=["mv_probe_unpop"]) is True


def test_is_rebuilding_false_when_view_populated(db_session):
    db_session.execute(text("CREATE MATERIALIZED VIEW mv_probe_pop AS SELECT 1 AS x WITH NO DATA"))
    db_session.execute(text("REFRESH MATERIALIZED VIEW mv_probe_pop"))
    assert is_rebuilding(db_session, views=["mv_probe_pop"]) is False


def test_is_rebuilding_false_when_no_views_match(db_session):
    assert is_rebuilding(db_session, views=["mv_does_not_exist"]) is False


def test_health_reports_rebuilding(client, monkeypatch):
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: True)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "rebuilding"


def test_health_ok_when_not_rebuilding(client, monkeypatch):
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: False)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_maintenance_precedes_rebuilding(client, monkeypatch):
    monkeypatch.setattr(main_module.settings, "maintenance_mode", True)
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: True)
    resp = client.get("/api/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "maintenance"


def test_health_is_explicitly_uncacheable(client, monkeypatch):
    # (#291) monitors must always see live status — never a cached one.
    monkeypatch.setattr(main_module, "is_rebuilding", lambda db: False)
    resp = client.get("/api/health")
    assert resp.headers.get("Cache-Control") == "no-store"


def test_health_maintenance_response_is_uncacheable(client, monkeypatch):
    monkeypatch.setattr(main_module.settings, "maintenance_mode", True)
    resp = client.get("/api/health")
    assert resp.status_code == 503
    assert resp.headers.get("Cache-Control") == "no-store"
