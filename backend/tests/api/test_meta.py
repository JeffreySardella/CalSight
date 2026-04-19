"""Integration tests for /api/meta/*."""

import pytest

pytestmark = pytest.mark.integration


def test_data_freshness_returns_latest_per_source(client):
    response = client.get("/api/meta/data-freshness")
    assert response.status_code == 200
    body = response.json()
    assert "ccrs" in body
    assert body["ccrs"]["rows_loaded"] == 4350202
    assert "switrs" in body
    assert body["switrs"]["rows_loaded"] == 6779445
