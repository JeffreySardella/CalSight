"""Tests for GET /api/stats/distribution — per-county metric distribution."""


def test_distribution_returns_all_counties(client):
    r = client.get("/api/stats/distribution?metric=crash_count")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert all("county_code" in row and "value" in row for row in body)


def test_distribution_rejects_bad_metric(client):
    r = client.get("/api/stats/distribution?metric=bogus")
    assert r.status_code == 422


def test_distribution_respects_alcohol_filter(client):
    # Of the seeded crashes only id=3 (county 19) is alcohol-involved.
    r = client.get("/api/stats/distribution?metric=crash_count&alcohol=true")
    assert r.status_code == 200
    by_county = {row["county_code"]: row["value"] for row in r.json()}
    assert by_county.get(19) == 1
    assert by_county.get(30, 0) == 0
    assert by_county.get(38, 0) == 0


def test_distribution_respects_county_filter(client):
    # County 19 (Los Angeles) has 3 seeded crashes; filtering should drop the rest.
    r = client.get("/api/stats/distribution?metric=crash_count&county=los-angeles")
    assert r.status_code == 200
    by_county = {row["county_code"]: row["value"] for row in r.json()}
    assert by_county.get(19) == 3
    assert 30 not in by_county
    assert 38 not in by_county


def test_distribution_unfiltered_still_returns_full_counts(client):
    # Backward-compat: no filters => county 19 keeps all 3 crashes.
    r = client.get("/api/stats/distribution?metric=crash_count")
    by_county = {row["county_code"]: row["value"] for row in r.json()}
    assert by_county.get(19) == 3
