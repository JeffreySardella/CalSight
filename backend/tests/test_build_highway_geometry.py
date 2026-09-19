"""Unit tests for building ca-highways.geojson from Caltrans SHN features."""

import inspect
from unittest.mock import MagicMock, patch

from etl.build_highway_geometry import (
    PAGE_SIZE,
    SIMPLIFY_TOLERANCE,
    build_geojson,
    fetch_shn_features,
    route_id_from_caltrans,
)


def _mock_response(features):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"type": "FeatureCollection", "features": features}
    return mock_resp


def _feature(route="5"):
    return {
        "type": "Feature",
        "properties": {"Route": route},
        "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
    }


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


def test_simplify_tolerance_is_the_finer_value():
    # Regression guard for the 0.005 -> 0.001 fidelity fix: main() uses this
    # constant directly now, instead of hardcoding a coarser tolerance.
    assert SIMPLIFY_TOLERANCE == 0.001


def test_build_geojson_default_tolerance_matches_the_module_constant():
    assert inspect.signature(build_geojson).parameters["simplify_tolerance"].default == SIMPLIFY_TOLERANCE


class TestFetchShnFeatures:
    """Paging via resultOffset/resultRecordCount against the Caltrans
    FeatureServer; retry/backoff itself belongs to etl._utils.get_with_retry."""

    @patch("etl.build_highway_geometry.get_with_retry")
    def test_single_short_page_stops_immediately(self, mock_get):
        mock_get.return_value = _mock_response([_feature("5"), _feature("101")])

        features = fetch_shn_features(page_size=1000)

        assert len(features) == 2
        assert mock_get.call_count == 1
        params = mock_get.call_args.kwargs["params"]
        assert params["f"] == "geojson"
        assert params["resultOffset"] == 0
        assert params["resultRecordCount"] == 1000

    @patch("etl.build_highway_geometry.get_with_retry")
    def test_pages_until_a_short_page(self, mock_get):
        full_page = [_feature("5") for _ in range(2)]
        last_page = [_feature("101")]
        mock_get.side_effect = [_mock_response(full_page), _mock_response(last_page)]

        features = fetch_shn_features(page_size=2)

        assert len(features) == 3
        assert mock_get.call_count == 2
        offsets = [c.kwargs["params"]["resultOffset"] for c in mock_get.call_args_list]
        assert offsets == [0, 2]

    @patch("etl.build_highway_geometry.get_with_retry")
    def test_empty_response_stops_paging(self, mock_get):
        mock_get.return_value = _mock_response([])

        assert fetch_shn_features() == []
        assert mock_get.call_count == 1

    def test_default_page_size_matches_module_constant(self):
        assert inspect.signature(fetch_shn_features).parameters["page_size"].default == PAGE_SIZE
