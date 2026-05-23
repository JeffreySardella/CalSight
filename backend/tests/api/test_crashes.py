"""Integration tests for /api/crashes."""

import pytest

pytestmark = pytest.mark.integration

# Covers every seeded crash year. /api/crashes requires a county/year/date_range
# filter as of #282 to prevent unfiltered bulk reads of per-crash rows.
ALL_YEARS = "year=2014,2015,2022,2023"


def test_crashes_returns_items_and_pagination(client):
    response = client.get(f"/api/crashes?{ALL_YEARS}&limit=10")
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
    response = client.get(f"/api/crashes?{ALL_YEARS}&severity=fatal")
    body = response.json()
    assert all(c["severity"] == "Fatal" for c in body["items"])


def test_crashes_filter_by_cause_dui(client):
    response = client.get(f"/api/crashes?{ALL_YEARS}&cause=dui")
    body = response.json()
    assert all(c["canonical_cause"] == "dui" for c in body["items"])


def test_crashes_filter_cause_lane_change_translates_hyphen(client):
    response = client.get(f"/api/crashes?{ALL_YEARS}&cause=lane-change")
    body = response.json()
    assert all(c["canonical_cause"] == "lane_change" for c in body["items"])


def test_crashes_alcohol_flag_excludes_switrs(client):
    response = client.get(f"/api/crashes?{ALL_YEARS}&alcohol=true")
    body = response.json()
    ids = {c["id"] for c in body["items"]}
    assert 3 in ids
    # SWITRS rows (1, 2) have NULL for is_alcohol_involved, so excluded.
    assert 1 not in ids and 2 not in ids


def test_crashes_distracted_flag(client):
    response = client.get(f"/api/crashes?{ALL_YEARS}&distracted=true")
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
    response = client.get(f"/api/crashes?{ALL_YEARS}&limit=10")
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


def test_crashes_cache_header_is_no_store(client):
    """Per #282 — public CDNs shouldn't memoize per-crash rows."""
    response = client.get(f"/api/crashes?{ALL_YEARS}")
    assert response.headers.get("cache-control") == "no-store"


def test_crashes_requires_minimum_filter(client):
    """Per #282 — unfiltered bulk reads of crash rows are rejected.
    At least one of county / year / start+end is required."""
    response = client.get("/api/crashes")
    assert response.status_code == 422
    body = response.json()
    assert body["filter"] == "filter"
    assert "county" in body["detail"]


def test_crashes_requires_filter_even_for_include_total(client):
    """Same minimum-filter requirement applies regardless of include_total."""
    response = client.get("/api/crashes?include_total=true")
    assert response.status_code == 422
    assert response.json()["filter"] == "filter"


def test_crashes_accepts_other_filters_alongside_minimum(client):
    """severity / cause / alcohol filters are still valid — they just can't
    appear alone without one of county / year / date range."""
    response = client.get(f"/api/crashes?{ALL_YEARS}&severity=fatal")
    assert response.status_code == 200


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
