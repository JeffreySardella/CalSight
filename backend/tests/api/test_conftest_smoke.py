"""Smoke test: fixtures create and seed the DB, TestClient works."""

import pytest

pytestmark = pytest.mark.integration


def test_client_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_seed_counties_present(db_session):
    from app.models import County
    names = sorted(c.name for c in db_session.query(County).all())
    assert names == ["Alameda", "Los Angeles", "Orange", "Sacramento", "San Francisco"]
