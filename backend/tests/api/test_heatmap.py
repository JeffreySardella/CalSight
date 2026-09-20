"""Integration tests for /api/crashes/heatmap."""

from datetime import datetime
from unittest.mock import patch

import pytest

import app.routers.heatmap as heatmap_mod
from app.models import Crash
from app.routers.heatmap import clear_heatmap_cache

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _fresh_heatmap_cache():
    clear_heatmap_cache()
    yield
    clear_heatmap_cache()


def test_heatmap_returns_points_and_total(client):
    response = client.get("/api/crashes/heatmap?county=los-angeles")
    assert response.status_code == 200
    body = response.json()
    assert "points" in body
    assert "total_crashes" in body
    assert isinstance(body["points"], list)
    assert isinstance(body["total_crashes"], int)


def test_heatmap_point_shape(client):
    response = client.get("/api/crashes/heatmap?county=los-angeles")
    body = response.json()
    assert len(body["points"]) > 0
    point = body["points"][0]
    assert "lat" in point
    assert "lng" in point
    assert "weight" in point


def test_heatmap_default_resolution_statewide_is_low(client):
    """Without county filter, resolution defaults to low (0.1 deg)."""
    response = client.get("/api/crashes/heatmap")
    assert response.status_code == 200
    body = response.json()
    for pt in body["points"]:
        decimals = len(str(pt["lat"]).split(".")[-1]) if "." in str(pt["lat"]) else 0
        assert decimals <= 1


def test_heatmap_default_resolution_county_is_medium(client):
    """With county filter, resolution defaults to medium (0.01 deg)."""
    response = client.get("/api/crashes/heatmap?county=los-angeles")
    assert response.status_code == 200
    body = response.json()
    assert body["total_crashes"] > 0


def test_heatmap_high_resolution_requires_county(client):
    response = client.get("/api/crashes/heatmap?resolution=high")
    assert response.status_code == 422
    assert response.json()["filter"] == "resolution"


def test_heatmap_high_resolution_with_county_works(client):
    response = client.get("/api/crashes/heatmap?county=los-angeles&resolution=high")
    assert response.status_code == 200
    body = response.json()
    assert body["total_crashes"] > 0


def test_heatmap_filter_by_year(client):
    response = client.get("/api/crashes/heatmap?year=2023")
    body = response.json()
    assert body["total_crashes"] == 2  # crashes 4 (Orange) + 5 (SF)


def test_heatmap_filter_by_severity(client):
    response = client.get("/api/crashes/heatmap?severity=fatal")
    body = response.json()
    assert body["total_crashes"] == 2  # crashes 1 (SWITRS) + 3 (CCRS)


def test_heatmap_filter_by_cause(client):
    response = client.get("/api/crashes/heatmap?cause=dui")
    body = response.json()
    assert body["total_crashes"] == 2  # crashes 1 + 3


def test_heatmap_no_matching_crashes(client):
    response = client.get("/api/crashes/heatmap?year=2001")
    assert response.status_code == 200
    body = response.json()
    assert body["points"] == []
    assert body["total_crashes"] == 0


def test_heatmap_cache_header(client):
    response = client.get("/api/crashes/heatmap")
    assert response.headers.get("cache-control") == "public, max-age=3600, stale-while-revalidate=86400"


def test_heatmap_rejects_unknown_county(client):
    response = client.get("/api/crashes/heatmap?county=atlantis")
    assert response.status_code == 422
    assert response.json()["filter"] == "county"


def test_heatmap_total_equals_sum_of_weights(client):
    response = client.get("/api/crashes/heatmap")
    body = response.json()
    weight_sum = sum(p["weight"] for p in body["points"])
    assert weight_sum == body["total_crashes"]


def test_heatmap_grid_cached_within_ttl(client):
    """A repeat grid request with identical filters is served from the TTL
    cache; a different filter tuple misses and recomputes."""
    with patch.object(heatmap_mod, "_compute_grid", wraps=heatmap_mod._compute_grid) as spy:
        first = client.get("/api/crashes/heatmap").json()
        assert spy.call_count == 1
        assert client.get("/api/crashes/heatmap").json() == first
        assert spy.call_count == 1
        client.get("/api/crashes/heatmap?severity=fatal")
        assert spy.call_count == 2


def test_heatmap_medium_statewide_does_not_require_county(client):
    """medium is allowed unscoped (the statewide-heatmap Resolution toggle
    offers Low/Medium with no county involved) — it must not 422 like
    raw/high do."""
    response = client.get("/api/crashes/heatmap?resolution=medium&year=2023")
    assert response.status_code == 200


def test_heatmap_raw_default_detail_is_full(client):
    """Backward compat: no `detail` param -> full point shape, unchanged."""
    response = client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw")
    body = response.json()
    assert body["points"], "expected raw points for los-angeles"
    point = body["points"][0]
    for field in ("severity", "collision_id", "data_source", "canonical_cause"):
        assert field in point


def test_heatmap_raw_detail_slim_shape(client):
    """detail=slim -> only lat/lng/weight are populated; other keys stay in
    the envelope (same schema) but are null, exactly like the grid branches
    already do."""
    response = client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw&detail=slim")
    assert response.status_code == 200
    body = response.json()
    assert body["points"], "expected raw points for los-angeles"
    for point in body["points"]:
        assert point["lat"] is not None
        assert point["lng"] is not None
        assert point["weight"] == 1
        # Slim points carry nothing but the three fields the heat layer uses;
        # the detail fields are absent, not shipped as nulls.
        assert set(point) == {"lat", "lng", "weight"}


def test_heatmap_raw_bbox_restricts_points(client):
    """bbox around crash 1 (34.0, -118.0) only, excluding crash 2 (34.1, -118.1)."""
    response = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw"
        "&bbox=-118.02,33.98,-117.98,34.02"
    )
    assert response.status_code == 200
    body = response.json()
    lats = [p["lat"] for p in body["points"]]
    assert lats, "expected at least crash 1 inside the bbox"
    assert all(33.98 <= lat <= 34.02 for lat in lats)
    assert 34.1 not in lats


def test_heatmap_raw_bbox_caps_at_limit(client):
    response = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw"
        "&bbox=-119,33,-117,35&limit=1"
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["points"]) <= 1


def test_heatmap_raw_bbox_limit_over_max_is_422(client):
    response = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw"
        "&bbox=-119,33,-117,35&limit=2001"
    )
    assert response.status_code == 422


def test_heatmap_bbox_rejects_bad_input(client):
    response = client.get("/api/crashes/heatmap?bbox=not,a,valid,bbox")
    assert response.status_code == 422
    assert response.json()["filter"] == "bbox"


def test_heatmap_bbox_narrows_grid_resolution(client):
    """bbox is honored for grid resolutions too, as a plain extra predicate."""
    all_la = client.get("/api/crashes/heatmap?county=los-angeles&resolution=medium").json()
    narrowed = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=medium"
        "&bbox=-118.02,33.98,-117.98,34.02"
    ).json()
    assert narrowed["total_crashes"] < all_la["total_crashes"]


def test_heatmap_cache_key_separates_detail_and_bbox(client):
    """A slim request must not be served from a full-detail cache entry (or
    vice versa), and a bboxed grid request must not share a cache slot with
    the unscoped one."""
    with patch.object(heatmap_mod, "_compute_grid", wraps=heatmap_mod._compute_grid) as spy:
        client.get("/api/crashes/heatmap?county=los-angeles&resolution=medium")
        assert spy.call_count == 1
        client.get("/api/crashes/heatmap?county=los-angeles&resolution=medium")
        assert spy.call_count == 1, "identical request should hit the cache"
        client.get(
            "/api/crashes/heatmap?county=los-angeles&resolution=medium"
            "&bbox=-118.02,33.98,-117.98,34.02"
        )
        assert spy.call_count == 2, "bbox must not share a cache entry with the unscoped request"


def test_heatmap_raw_max_points_aggregates_when_exceeded(client):
    """With max_points below the raw row count, the response collapses to a
    grid (lat/lng/weight only) and echoes the chosen grid_step; total_crashes
    (the summed weight) is preserved exactly."""
    raw = client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw").json()
    assert raw["total_crashes"] == 3  # crashes 1-3 seeded for Los Angeles
    assert raw["grid_step"] is None

    aggregated = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw&max_points=1"
    ).json()
    assert aggregated["grid_step"] is not None
    assert aggregated["total_crashes"] == raw["total_crashes"]
    assert sum(p["weight"] for p in aggregated["points"]) == raw["total_crashes"]
    for p in aggregated["points"]:
        assert set(p) == {"lat", "lng", "weight"}  # aggregated points are always slim-shaped


def test_heatmap_raw_aggregated_response_echoes_the_requested_batch(client):
    """The batched client asks for batch=1 and only accepts a response whose
    `batch` matches, stopping when batch == total_batches. An aggregated answer
    is complete in one response, so it must say batch 1 of 1 — a null batch
    would leave the client waiting forever with an empty heat layer."""
    url = "/api/crashes/heatmap?county=los-angeles&resolution=raw&detail=slim&max_points=1&batch=1&batch_size=150000"
    first = client.get(url).json()
    assert first["grid_step"] is not None
    assert first["batch"] == 1
    assert first["total_batches"] == 1

    # Served from the TTL cache the second time: same echo, cache not mutated.
    assert client.get(url).json()["batch"] == 1
    unbatched = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw&detail=slim&max_points=1"
    ).json()
    assert unbatched["batch"] is None
    assert unbatched["total_batches"] is None


def test_heatmap_raw_max_points_not_exceeded_is_unaggregated(client):
    """Comfortably above the row count: no aggregation, grid_step stays null."""
    response = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw&max_points=100000"
    )
    body = response.json()
    assert body["grid_step"] is None
    assert len(body["points"]) == body["total_crashes"] == 3


def test_heatmap_max_points_ignored_for_grid_resolution(client):
    """max_points only applies to raw; passing it with a grid resolution is a
    no-op (grid output is already bounded)."""
    without = client.get("/api/crashes/heatmap?county=los-angeles&resolution=medium").json()
    with_mp = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=medium&max_points=1"
    ).json()
    assert with_mp["points"] == without["points"]
    assert with_mp["grid_step"] is None


def test_heatmap_raw_max_points_picks_finer_step_than_bbox_estimate_for_sparse_data(client, db_session):
    """3 tight clusters of 7 crashes each (like crashes bunched on streets),
    but the clusters themselves sit far apart (d_lat=6, d_lng=4) — like a
    county's crashes spanning a big, sparsely-populated bounding box. The
    geometric estimate at EVERY ladder rung, including the coarsest (1.0
    deg: ceil(6/1)*ceil(4/1)=24), exceeds max_points=10, so a naive
    estimate-only chooser never trusts any rung. But because each cluster's
    spread (~0.00006 deg) is tiny next to any ladder step, the real
    distinct-cell count is 3 (one per cluster) at every step from the
    finest up through at least 0.02 — so the correct, fine-grained answer
    is available and must come from actual counts, not the estimate."""
    clusters = [(34.0, -118.0), (40.0, -120.0), (36.0, -116.0)]
    extra = []
    for k, (lat, lng) in enumerate((c for c in clusters for _ in range(7))):
        extra.append(Crash(
            id=9200 + k, collision_id=92000 + k, data_source="ccrs",
            crash_datetime=datetime(2020, 6, 1, 10, 0), county_code=19,
            crash_year=2020, crash_hour=10, crash_month=6, day_of_week_num=0,
            severity="Injury", canonical_cause="other",
            number_killed=0, number_injured=1,
            county_name="Los Angeles",
            latitude=lat + (k % 7) * 0.00001, longitude=lng + (k % 7) * 0.00001,
            is_alcohol_involved=False, is_distraction_involved=False,
        ))
    db_session.add_all(extra)
    db_session.commit()

    response = client.get(
        "/api/crashes/heatmap?county=los-angeles&resolution=raw&year=2020&max_points=10"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_crashes"] == 21
    assert sum(p["weight"] for p in body["points"]) == 21
    assert body["grid_step"] is not None
    assert body["grid_step"] < 1.0, (
        "a naive estimate-only chooser rejects every ladder rung here and "
        "falls back to the coarsest (1.0 deg) — the real per-cluster count "
        "fits far finer than that"
    )
    assert len(body["points"]) == 3  # one cell per cluster


def test_heatmap_cache_key_separates_max_points(client):
    with patch.object(heatmap_mod, "_compute_grid", wraps=heatmap_mod._compute_grid) as spy:
        client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw&max_points=1")
        assert spy.call_count == 1
        client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw&max_points=1")
        assert spy.call_count == 1, "identical max_points request should hit the cache"
        client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw&max_points=2")
        assert spy.call_count == 2, "a different max_points must not share a cache entry"


def test_heatmap_medium_statewide_uses_coarser_step_than_county_scoped(client):
    """Unscoped medium groups the full crashes table — 9.3 MB of JSON for one
    statewide year in the 2026-09-18 sweep. Guard the size at the source with
    a coarser grid step (mirroring how `low` stays small at any scope) rather
    than requiring a county the frontend doesn't always pass. Pin the coarser
    step directly: every unscoped-medium point must land on a multiple of
    _STATEWIDE_MEDIUM_STEP, not the finer 0.01 used once a county scopes it."""
    statewide = client.get("/api/crashes/heatmap?resolution=medium&year=2023").json()
    assert statewide["points"], "expected at least one grid cell"
    step = heatmap_mod._STATEWIDE_MEDIUM_STEP
    for pt in statewide["points"]:
        bucket = round(pt["lat"] / step)
        assert pt["lat"] == pytest.approx(bucket * step, abs=1e-6)

    # LA's seeded crashes (ids 1-3) are all pre-2023 — omit the year filter
    # here so the county-scoped request actually has points to check.
    scoped = client.get(
        "/api/crashes/heatmap?resolution=medium&county=los-angeles"
    ).json()
    assert scoped["points"], "expected at least one grid cell"
    fine_step = heatmap_mod._STEP[heatmap_mod.Resolution.medium]
    for pt in scoped["points"]:
        bucket = round(pt["lat"] / fine_step)
        assert pt["lat"] == pytest.approx(bucket * fine_step, abs=1e-6)


def test_heatmap_full_detail_points_keep_their_values_and_drop_only_empty_ones(client):
    """Dropping empty fields must not drop real ones: a full-detail raw point
    still carries its severity and ids, and never an explicit null."""
    body = client.get("/api/crashes/heatmap?county=los-angeles&resolution=raw").json()
    assert body["points"]
    for point in body["points"]:
        assert point["severity"] is not None
        assert point["collision_id"] is not None
        assert None not in point.values()
    # The envelope keeps its keys, null or not: clients read them by name.
    assert {"batch", "total_batches", "grid_step"} <= set(body)


def test_heatmap_grid_points_are_three_fields_only(client):
    body = client.get("/api/crashes/heatmap?county=los-angeles&resolution=low").json()
    assert body["points"]
    assert all(set(p) == {"lat", "lng", "weight"} for p in body["points"])
