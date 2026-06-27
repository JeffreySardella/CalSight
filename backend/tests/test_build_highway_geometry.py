"""Unit tests for building ca-highways.geojson from Caltrans SHN features."""

from etl.build_highway_geometry import build_geojson, route_id_from_caltrans


def test_route_id_maps_known_interstate():
    assert route_id_from_caltrans("5") == "I-5"


def test_route_id_maps_known_us_route():
    assert route_id_from_caltrans("101") == "US-101"


def test_route_id_strips_prefix_text():
    # Caltrans values sometimes carry text; the digits still resolve.
    assert route_id_from_caltrans("SR 99") == "SR-99"


def test_route_id_unknown_returns_none():
    assert route_id_from_caltrans("9999") is None


def test_route_id_empty_returns_none():
    assert route_id_from_caltrans("") is None


def _line(route, coords):
    return {
        "type": "Feature",
        "properties": {"Route": route},
        "geometry": {"type": "LineString", "coordinates": coords},
    }


def test_build_geojson_groups_by_route():
    fc = build_geojson([_line("5", [[0, 0], [1, 1]]), _line("5", [[1, 1], [2, 2]])])
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 1
    feat = fc["features"][0]
    assert feat["properties"]["route_number"] == "I-5"
    assert feat["geometry"]["type"] in ("MultiLineString", "LineString")


def test_build_geojson_separates_distinct_routes():
    fc = build_geojson([_line("5", [[0, 0], [1, 1]]), _line("101", [[2, 2], [3, 3]])])
    ids = sorted(f["properties"]["route_number"] for f in fc["features"])
    assert ids == ["I-5", "US-101"]


def test_build_geojson_drops_unknown_routes():
    bad = _line("9999", [[0, 0], [1, 1]])
    assert build_geojson([bad])["features"] == []
