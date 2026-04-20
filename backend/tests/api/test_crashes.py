"""Integration tests for /api/crashes."""

import pytest

pytestmark = pytest.mark.integration


def test_crashes_returns_items_and_pagination(client):
    response = client.get("/api/crashes?limit=10")
    assert response.status_code == 200
    body = response.json()
    assert body["limit"] == 10
    assert body["offset"] == 0
    assert body["total"] is None  # opt-in
    assert isinstance(body["items"], list)


def test_crashes_filter_by_year(client):
    response = client.get("/api/crashes?year=2023")
    body = response.json()
    assert all(c["crash_datetime"].startswith("2023") for c in body["items"])


def test_crashes_filter_by_county(client):
    response = client.get("/api/crashes?county=los-angeles")
    body = response.json()
    assert all(c["county_code"] == 19 for c in body["items"])


def test_crashes_filter_by_severity_fatal(client):
    response = client.get("/api/crashes?severity=fatal")
    body = response.json()
    assert all(c["severity"] == "Fatal" for c in body["items"])


def test_crashes_filter_by_cause_dui(client):
    response = client.get("/api/crashes?cause=dui")
    body = response.json()
    assert all(c["canonical_cause"] == "dui" for c in body["items"])


def test_crashes_filter_cause_lane_change_translates_hyphen(client):
    response = client.get("/api/crashes?cause=lane-change")
    body = response.json()
    assert all(c["canonical_cause"] == "lane_change" for c in body["items"])


def test_crashes_alcohol_flag_excludes_switrs(client):
    response = client.get("/api/crashes?alcohol=true")
    body = response.json()
    ids = {c["id"] for c in body["items"]}
    assert 3 in ids
    # SWITRS rows (1, 2) have NULL for is_alcohol_involved, so excluded.
    assert 1 not in ids and 2 not in ids


def test_crashes_distracted_flag(client):
    response = client.get("/api/crashes?distracted=true")
    body = response.json()
    ids = {c["id"] for c in body["items"]}
    # Only crash id=4 was seeded with is_distraction_involved=True.
    assert ids == {4}


def test_crashes_rejects_severe_injury_slug(client):
    response = client.get("/api/crashes?severity=severe-injury")
    assert response.status_code == 422
    assert response.json()["filter"] == "severity"


def test_crashes_rejects_distracted_as_cause(client):
    response = client.get("/api/crashes?cause=distracted")
    assert response.status_code == 422
    assert response.json()["filter"] == "cause"


def test_crashes_rejects_unknown_county(client):
    response = client.get("/api/crashes?county=atlantis")
    assert response.status_code == 422
    assert response.json()["filter"] == "county"


def test_crashes_sort_descending_by_datetime(client):
    response = client.get("/api/crashes?limit=10")
    body = response.json()
    dts = [c["crash_datetime"] for c in body["items"]]
    assert dts == sorted(dts, reverse=True)


def test_crashes_include_total(client):
    # include_total now requires a filter (see #106 / perf docs); year=2015,…
    # covers every seeded crash.
    response = client.get("/api/crashes?include_total=true&year=2014,2015,2022,2023&limit=10")
    body = response.json()
    assert body["total"] is not None
    assert body["total"] == 5  # total seeded rows


def test_crashes_join_key_is_collision_plus_source(client):
    # Two crashes seeded with collision_id=100: one SWITRS (2015), one CCRS (2022).
    r1 = client.get("/api/crashes?year=2015").json()["items"]
    r2 = client.get("/api/crashes?year=2022").json()["items"]
    assert {c["data_source"] for c in r1} == {"switrs"}
    assert {c["data_source"] for c in r2} == {"ccrs"}
    assert any(c["collision_id"] == 100 for c in r1)
    assert any(c["collision_id"] == 100 for c in r2)


def test_crashes_cache_header(client):
    response = client.get("/api/crashes")
    assert response.headers.get("cache-control") == "public, max-age=300"


def test_crashes_include_total_without_filter_returns_422(client):
    """Unfiltered include_total=true is rejected — would require a multi-minute
    COUNT(*) over 11M rows. Users should add a filter or use /api/stats for
    aggregate totals. Proper fix is the covering index in #106."""
    response = client.get("/api/crashes?include_total=true")
    assert response.status_code == 422
    body = response.json()
    assert body["filter"] == "include_total"
    assert "at least one filter" in body["detail"]
    assert "/api/stats" in body["detail"]


def test_crashes_include_total_timeout_returns_null(client, monkeypatch):
    """When COUNT(*) exceeds statement_timeout, endpoint returns total=null
    with items still populated — graceful degradation, not a 500 or a hang.

    We can't reliably trigger a real timeout on a 5-row test fixture (it
    finishes in <1ms), so we patch `Query.count` to raise OperationalError,
    which is what Postgres raises when statement_timeout fires.
    """
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Query

    def raise_timeout(self):
        raise OperationalError(
            "COUNT(*)", {}, Exception("canceling statement due to statement timeout")
        )

    monkeypatch.setattr(Query, "count", raise_timeout)

    # Must include a filter — include_total is rejected without one.
    response = client.get("/api/crashes?include_total=true&year=2023&limit=2")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] is None
    assert len(body["items"]) >= 1
