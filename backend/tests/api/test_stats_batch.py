"""Tests for POST /api/stats/batch."""


def test_batch_returns_requested_groups(client):
    response = client.post("/api/stats/batch", json={
        "groups": ["year", "hour"],
    })
    assert response.status_code == 200
    data = response.json()
    assert "year" in data
    assert "hour" in data
    assert isinstance(data["year"], list)
    assert isinstance(data["hour"], list)


def test_batch_rejects_invalid_group(client):
    response = client.post("/api/stats/batch", json={
        "groups": ["year", "bogus"],
    })
    assert response.status_code in (400, 422)


def test_batch_cache_header(client):
    response = client.post("/api/stats/batch", json={"groups": ["year"]})
    assert "max-age=3600" in response.headers.get("cache-control", "")
