"""Integration tests for /api/freshness and /api/meta/data-freshness."""

import pytest

pytestmark = pytest.mark.integration


# --- GET /api/freshness ---


def test_freshness_returns_source_list(client):
    response = client.get("/api/freshness")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 2


def test_freshness_entries_have_required_fields(client):
    response = client.get("/api/freshness")
    body = response.json()
    for entry in body:
        assert "source" in entry
        assert "rows_loaded" in entry
        assert "is_stale" in entry


def test_freshness_contains_seeded_sources(client):
    response = client.get("/api/freshness")
    body = response.json()
    sources = {entry["source"] for entry in body}
    assert "ccrs" in sources
    assert "switrs" in sources


def test_freshness_has_cache_control(client):
    response = client.get("/api/freshness")
    assert "max-age" in response.headers.get("Cache-Control", "")


# --- GET /api/freshness/summary ---


def test_freshness_summary_returns_dict(client):
    response = client.get("/api/freshness/summary")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, dict)
    assert "overall_status" in body


# --- GET /api/meta/data-freshness ---


def test_meta_data_freshness_returns_dict_keyed_by_source(client):
    response = client.get("/api/meta/data-freshness")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, dict)
    assert "ccrs" in body
    assert "switrs" in body


def test_meta_data_freshness_entry_shape(client):
    response = client.get("/api/meta/data-freshness")
    body = response.json()
    for source_name, entry in body.items():
        assert "last_loaded_at" in entry
        assert "rows_loaded" in entry
