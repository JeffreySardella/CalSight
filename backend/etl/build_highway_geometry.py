"""Build frontend/public/ca-highways.geojson from the Caltrans State Highway
Network (SHN) line layer.

Produces one simplified MultiLineString per canonical California route, so the
Map page can draw highways and color them by crash danger.

Source: Caltrans GIS open data — "State Highway Network" (lines). The layer's
`Route` attribute is the bare route number; we resolve it to the canonical ID
(I-5 / US-101 / SR-99) via app.ca_highways and keep only routes we recognize.

Reproducible run:
  1. Download the SHN line GeoJSON to backend/data/shn_raw.geojson
  2. From backend/:  python -m etl.build_highway_geometry
"""

import json
import re
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import linemerge, unary_union

from app.ca_highways import resolve_route

_DIGITS = re.compile(r"(\d+)")


def route_id_from_caltrans(route_field: str) -> str | None:
    """Map a Caltrans SHN `Route` value to a canonical highway ID.

    Pulls the first run of digits out of the field (values can look like
    "5", "SR 99", "US101") and resolves it via app.ca_highways. Returns None
    for routes we don't have a canonical entry for.
    """
    match = _DIGITS.search(str(route_field))
    if not match:
        return None
    highway = resolve_route(int(match.group(1)))
    return highway.canonical_id if highway else None


def build_geojson(features: list[dict], simplify_tolerance: float = 0.001) -> dict:
    """Group SHN line features by canonical route, union + simplify each.

    Returns a FeatureCollection with one Feature per known route:
    `{properties: {route_number}, geometry: MultiLineString | LineString}`.
    Unknown routes are dropped.
    """
    by_route: dict[str, list] = {}
    for feat in features:
        route_id = route_id_from_caltrans(feat.get("properties", {}).get("Route", ""))
        if route_id is None:
            continue
        by_route.setdefault(route_id, []).append(shape(feat["geometry"]))

    out_features = []
    for route_id in sorted(by_route):
        # linemerge stitches the SHN's many short, contiguous segments into long
        # LineStrings first; without it, simplify can't collapse vertices across
        # segment boundaries and the output stays ~40x larger. linemerge only
        # accepts a MultiLineString, so a single-segment route (which unions to a
        # plain LineString) skips it.
        unioned = unary_union(by_route[route_id])
        if unioned.geom_type == "MultiLineString":
            unioned = linemerge(unioned)
        merged = unioned.simplify(simplify_tolerance, preserve_topology=True)
        out_features.append(
            {
                "type": "Feature",
                "properties": {"route_number": route_id},
                "geometry": mapping(merged),
            }
        )
    return {"type": "FeatureCollection", "features": out_features}


def main() -> None:
    raw_path = Path("data/shn_raw.geojson")
    raw = json.loads(raw_path.read_text())
    # 0.005 deg (~550m) keeps statewide highway lines visually faithful while
    # holding the static asset well under 1 MB.
    fc = build_geojson(raw["features"], simplify_tolerance=0.005)
    out_path = Path("../frontend/public/ca-highways.geojson")
    out_path.write_text(json.dumps(fc))
    size_kb = out_path.stat().st_size / 1024
    print(f"wrote {len(fc['features'])} routes -> {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
