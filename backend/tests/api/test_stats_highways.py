"""Integration tests for /api/stats/highways."""

import pytest

pytestmark = pytest.mark.integration


def test_highways_returns_ranked_routes(client):
    response = client.get("/api/stats/highways")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    # Seed has 4 crashes with route_number (3 on I-5, 1 on US-101) and one
    # NULL — endpoint should surface 2 routes and skip the NULL row.
    assert len(body) == 2
    routes = {row["route_number"] for row in body}
    assert routes == {"I-5", "US-101"}


def test_highways_default_sort_is_crash_count(client):
    body = client.get("/api/stats/highways").json()
    # I-5 has 3 crashes in the seed, US-101 has 1 — so I-5 must come first.
    assert body[0]["route_number"] == "I-5"
    assert body[0]["crash_count"] == 3
    assert body[1]["route_number"] == "US-101"
    assert body[1]["crash_count"] == 1


def test_highways_includes_miles_and_per_mile(client):
    body = client.get("/api/stats/highways").json()
    i5 = next(r for r in body if r["route_number"] == "I-5")
    assert i5["miles"] is not None
    assert i5["miles"] > 0
    assert i5["crashes_per_mile"] == pytest.approx(i5["crash_count"] / i5["miles"], rel=1e-6)


def test_highways_fatality_rate(client):
    body = client.get("/api/stats/highways?sort=fatality_rate").json()
    # I-5 has 2 fatals out of 3 crashes → rate 0.6667.
    # US-101 has 0 fatals out of 1 → rate 0.0. So I-5 first.
    assert body[0]["route_number"] == "I-5"
    assert body[0]["fatality_rate"] == pytest.approx(2 / 3, abs=1e-4)
    assert body[1]["fatality_rate"] == 0.0


def test_highways_sort_per_mile_excludes_unknown_mileage(client):
    # Both seeded routes have known mileage so they should both still be
    # returned, just ordered by crashes/mile.
    body = client.get("/api/stats/highways?sort=crashes_per_mile").json()
    rates = [r["crashes_per_mile"] for r in body]
    assert rates == sorted(rates, reverse=True)
    assert all(r is not None for r in rates)


def test_highways_filters_apply(client):
    # Filter to only 2023 — US-101 (seed crash 4) is 2023, all 3 I-5 are not.
    body = client.get("/api/stats/highways?year=2023").json()
    routes = {r["route_number"] for r in body}
    assert routes == {"US-101"}
    assert body[0]["crash_count"] == 1


def test_highways_county_filter(client):
    body = client.get("/api/stats/highways?county=orange").json()
    # Only crash 4 is in Orange County, and its route is US-101.
    routes = {r["route_number"] for r in body}
    assert routes == {"US-101"}


def test_highways_per_mile_is_null_under_a_county_filter(client):
    """crashes_per_mile must not divide a county-scoped count by statewide miles.

    ca_highways carries a route's FULL California centerline length and has no
    county dimension, so under a county filter the numerator covered one county
    while the denominator covered the whole state — I-5 scoped to San Diego read
    roughly 10x too low, and that value fed the map's "Per Mile" colouring.
    There is no in-county mileage to divide by, so the rate must report as
    unavailable rather than wrong.
    """
    body = client.get("/api/stats/highways?county=orange").json()
    assert body, "expected at least one route in Orange County"
    for row in body:
        assert row["crashes_per_mile"] is None, (
            f"{row['route_number']} published a per-mile rate under a county filter"
        )
        # The route's own length is still a fact about the route, so it stays.
        assert row["miles"] is not None and row["miles"] > 0


def test_highways_per_mile_sort_still_returns_rows_under_county_filter(client):
    """Ranking by a rate we just declared unavailable must not silently return
    an empty list — that would read as "no dangerous highways in this county".
    It falls back to crash-count order instead."""
    body = client.get("/api/stats/highways?county=orange&sort=crashes_per_mile").json()
    assert body, "county + per-mile sort returned nothing instead of falling back"
    counts = [r["crash_count"] for r in body]
    assert counts == sorted(counts, reverse=True)


def test_highways_per_mile_still_computed_statewide(client):
    """The statewide case is unaffected — numerator and denominator agree."""
    body = client.get("/api/stats/highways").json()
    i5 = next(r for r in body if r["route_number"] == "I-5")
    assert i5["crashes_per_mile"] == pytest.approx(i5["crash_count"] / i5["miles"], rel=1e-6)


def test_highways_limit_clamps_to_max(client):
    response = client.get("/api/stats/highways?limit=999")
    # Out-of-range limit should reject with 422 (FastAPI/pydantic le=300).
    assert response.status_code == 422


def test_highways_accepts_full_network_limit(client):
    # The highway-danger map layer (HighwayDangerLayer HIGHWAY_LIMIT) fetches
    # limit=300 to color every drawn route. The cap must accept it, or the
    # layer's fetch 422s and every highway falls back to no-data gray.
    response = client.get("/api/stats/highways?limit=300")
    assert response.status_code == 200


def test_highways_invalid_sort_rejected(client):
    response = client.get("/api/stats/highways?sort=bogus")
    assert response.status_code == 422
