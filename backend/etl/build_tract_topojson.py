"""Build frontend/public/ca-tracts.topo.json from the Census TIGERweb service.

One-shot build script, like frontend/scripts/enrich-counties.mjs — the output
is committed and served as a static asset, the same way ca-counties.topo.json
is. Re-run it only when the tract vintage changes (CES 5.0 is scored on 2020
tracts, so that is not soon).

Boundaries come from the same TIGERweb layer etl.compute_tract_crashes joins
against, so the map and the aggregate can never disagree about which polygon
a GEOID is.

Why TopoJSON and not GeoJSON: the tract polygons share almost every boundary
with a neighbour. TopoJSON stores each shared arc once and quantizes
coordinates to integers, which is the difference between a multi-megabyte
download and one a phone will tolerate.

Requires the `topojson` package (backend/requirements-dev.txt) — build-time
only, not installed in the API or pipeline containers. It reads the GeoJSON
FeatureCollection directly; no geopandas involved.

Usage:
    python -m etl.build_tract_topojson
    python -m etl.build_tract_topojson --simplify 0.003 --quantize 2000
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
from pathlib import Path

from etl.compute_tract_crashes import fetch_tract_features

logger = logging.getLogger(__name__)

OUTPUT = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "public" / "ca-tracts.topo.json"
)

# Degrees, applied AFTER the topology is built, so shared borders stay shared
# (no slivers between neighbours). 0.002 deg is ~220 m — below what a tract
# outline resolves to at the zoom levels this layer is used at, and gentle
# enough that no tract collapses to an empty geometry (the build asserts it).
DEFAULT_SIMPLIFY = 0.002
# Integer grid the simplified coordinates are snapped to. 3,000 steps over
# California's ~10-degree span is ~370 m; the resulting error is dwarfed by
# the simplification above, and it is what makes the arcs compress.
DEFAULT_QUANTIZE = 3e3


def build(simplify: float, quantize: float) -> dict:
    """Return the TopoJSON topology for the CA tracts, keyed by GEOID."""
    import topojson as tp

    # generalize=0 on purpose, unlike the crash join. The service's own
    # generalisation moves each polygon's vertices independently, so
    # neighbouring tracts stop sharing exact boundaries and TopoJSON has to
    # store two arcs where it should store one — measured at 2,304 KB against
    # 1,426 KB from the ungeneralised source. The download is ~48 MB and takes
    # a couple of minutes; this runs once per tract vintage.
    features = fetch_tract_features(generalize=0, page_size=500)
    topo = tp.Topology(
        {"type": "FeatureCollection", "features": list(features)},
        object_name="tracts",
        # High prequantize: the delta-encoding happens before simplification,
        # so a coarse grid here would round vertices away before the
        # simplifier gets to choose which ones matter.
        prequantize=1e6,
        toposimplify=simplify,
        topoquantize=quantize,
    )
    topology = json.loads(topo.to_json())

    geometries = topology["objects"]["tracts"]["geometries"]
    for g in geometries:
        # The GEOID is the only attribute, so carry it as the TopoJSON `id`
        # (which topojson-client copies onto feature.id) rather than a
        # one-key `properties` object. Saves ~250 KB across 9,100 tracts.
        g["id"] = g.pop("properties")["GEOID"]

    collapsed = [g["id"] for g in geometries if not g.get("arcs")]
    if collapsed:
        raise ValueError(
            f"{len(collapsed)} tract(s) simplified away to nothing "
            f"(e.g. {collapsed[:3]}) — lower --simplify"
        )
    return topology


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--simplify", type=float, default=DEFAULT_SIMPLIFY)
    parser.add_argument("--quantize", type=float, default=DEFAULT_QUANTIZE)
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args()

    topology = build(args.simplify, args.quantize)
    # separators: json.dumps pads every comma and colon by default, which
    # over a few hundred thousand arc entries is ~100 KB of whitespace.
    payload = json.dumps(topology, separators=(",", ":")).encode("utf-8")
    args.out.write_bytes(payload)

    logger.info(
        "Wrote %s — %.0f KB raw, %.0f KB gzip, %d tracts",
        args.out,
        len(payload) / 1024,
        len(gzip.compress(payload, 9)) / 1024,
        len(topology["objects"]["tracts"]["geometries"]),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
        datefmt="%H:%M:%S",
    )
    main()
