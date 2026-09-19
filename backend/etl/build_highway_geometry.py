"""Build frontend/public/ca-highways.geojson from the Caltrans State Highway
Network (SHN) line layer.

Produces one simplified MultiLineString per canonical California route, so the
Map page can draw highways and color them by crash danger.

Source: Caltrans GIS open data — "State Highway Network" (lines), fetched
live from the ArcGIS FeatureServer. The layer's `Route` attribute is the bare
route number; we resolve it to the canonical ID (I-5 / US-101 / SR-99) via
app.ca_highways and keep only routes we recognize.

Reproducible run (from backend/):
  python -m etl.build_highway_geometry

Or reuse a local dump instead of hitting the network:
  python -m etl.build_highway_geometry --raw data/shn_raw.geojson
"""

import argparse
import json
import re
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import linemerge, unary_union

from app.ca_highways import resolve_route
from etl._utils import get_with_retry

_DIGITS = re.compile(r"(\d+)")

SHN_FEATURE_SERVICE_URL = (
    "https://caltrans-gis.dot.ca.gov/arcgis/rest/services"
    "/CHhighway/SHN_Lines/FeatureServer/0/query"
)

# ArcGIS REST caps resultRecordCount per request; page until a short page
# signals there's nothing left (works regardless of whether the server
# echoes exceededTransferLimit for f=geojson responses).
PAGE_SIZE = 1000

# 0.001 deg (~110m) keeps statewide highway lines visually tight at street
# zoom; Cloudflare Pages' gzip/brotli compresses the coordinate-heavy JSON
# ~3.5x, so the ~721 KB raw file still ships ~205 KB on the wire. (Was 0.005.)
SIMPLIFY_TOLERANCE = 0.001


def fetch_shn_features(page_size: int = PAGE_SIZE) -> list[dict]:
    """Download all SHN line features from the Caltrans FeatureServer.

    Pages via resultOffset/resultRecordCount and requests f=geojson so each
    page is already standard GeoJSON Features, matching the shape
    build_geojson() expects.
    """
    features: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "outFields": "Route",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "f": "geojson",
            # 6 decimal places is ~0.1m — far finer than our simplify
            # tolerance, but keeps coordinates from ballooning to full
            # float64 precision (~17 sig figs) and roughly tripling the
            # output size for no visual gain.
            "geometryPrecision": 6,
        }
        resp = get_with_retry(SHN_FEATURE_SERVICE_URL, params=params, timeout=60)
        page = resp.json().get("features", [])
        features.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return features


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


def build_geojson(features: list[dict], simplify_tolerance: float = SIMPLIFY_TOLERANCE) -> dict:
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--raw",
        type=Path,
        default=None,
        help="Reuse a local SHN GeoJSON dump instead of downloading from Caltrans.",
    )
    args = parser.parse_args()

    if args.raw:
        features = json.loads(args.raw.read_text())["features"]
    else:
        features = fetch_shn_features()

    fc = build_geojson(features, simplify_tolerance=SIMPLIFY_TOLERANCE)
    out_path = Path("../frontend/public/ca-highways.geojson")
    out_path.write_text(json.dumps(fc))
    size_kb = out_path.stat().st_size / 1024
    print(f"wrote {len(fc['features'])} routes -> {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
