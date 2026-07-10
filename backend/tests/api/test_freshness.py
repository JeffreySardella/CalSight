"""Integration tests for /api/freshness and /api/meta/data-freshness."""

from datetime import datetime, timedelta, timezone

import pytest

from app.models import EtlRun

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


# --- staleness keys off last upstream sync, not last row-load ---


def _get_source(body, name):
    return next((e for e in body if e["source"] == name), None)


def test_static_source_recently_checked_is_not_stale(client, db_session):
    """A source loaded long ago but confirmed unchanged recently is fresh."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, matches EtlRun columns
    db_session.add_all([
        EtlRun(source="hospitals", status="success", rows_loaded=500,
               started_at=now - timedelta(days=50, hours=1),
               finished_at=now - timedelta(days=50)),
        EtlRun(source="hospitals", status="skipped_unchanged",
               started_at=now - timedelta(hours=7),
               finished_at=now - timedelta(hours=7)),
    ])
    db_session.flush()

    body = client.get("/api/freshness").json()
    entry = _get_source(body, "hospitals")
    assert entry is not None
    assert entry["is_stale"] is False
    assert entry["hours_since_update"] > 1000   # data itself is old
    assert entry["hours_since_check"] < 24       # but checked recently


def test_source_not_checked_past_threshold_is_stale(client, db_session):
    """A source the pipeline hasn't even checked in weeks is stale."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, matches EtlRun columns
    db_session.add_all([
        EtlRun(source="weather", status="success", rows_loaded=10,
               started_at=now - timedelta(days=45, hours=1),
               finished_at=now - timedelta(days=45)),
        EtlRun(source="weather", status="skipped_unchanged",
               started_at=now - timedelta(days=40),
               finished_at=now - timedelta(days=40)),
    ])
    db_session.flush()

    body = client.get("/api/freshness").json()
    entry = _get_source(body, "weather")
    assert entry is not None
    assert entry["is_stale"] is True


def test_summary_counts_recently_checked_static_source_as_fresh(client, db_session):
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC, matches EtlRun columns
    db_session.add_all([
        EtlRun(source="demographics", status="success", rows_loaded=58,
               started_at=now - timedelta(days=48, hours=1),
               finished_at=now - timedelta(days=48)),
        EtlRun(source="demographics", status="skipped_unchanged",
               started_at=now - timedelta(hours=8),
               finished_at=now - timedelta(hours=8)),
    ])
    db_session.flush()

    summary = client.get("/api/freshness/summary").json()
    # demographics (720h threshold) checked 8h ago → must not inflate the count
    assert summary["sources_stale"] == 0


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
