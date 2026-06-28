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
