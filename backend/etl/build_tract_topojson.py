"""Build frontend/public/ca-tracts.topo.json from the Census boundary file.

One-shot build script, like frontend/scripts/enrich-counties.mjs — the output
is committed and served as a static asset, the same way ca-counties.topo.json
is. Re-run it only when the tract vintage changes (CES 5.0 is scored on 2020
tracts, so that is not soon).

Why TopoJSON and not GeoJSON: 9,109 tract polygons share almost every
boundary with a neighbour. TopoJSON stores each shared arc once and quantizes
coordinates to integers, which is the difference between a multi-megabyte
download and one a phone will tolerate. Measured at the defaults below:
1.43 MB raw / 362 KB gzip, against 4.5 MB for the source shapefile zip.

Requires the `topojson` package (backend/requirements-dev.txt) — build-time
only, not installed in the API or pipeline containers.

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

from etl.compute_tract_crashes import tract_boundaries

logger = logging.getLogger(__name__)

OUTPUT = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "public" / "ca-tracts.topo.json"
)

# Degrees, applied AFTER the topology is built, so shared borders stay shared
# (no slivers between neighbours). 0.0015 deg is ~165 m — below what a tract
# outline resolves to at the zoom levels this layer is used at, and gentle
# enough that no tract collapses to an empty geometry (the build asserts it).
DEFAULT_SIMPLIFY = 0.0015
# Integer grid the simplified coordinates are snapped to. 3,000 steps over
# California's ~10-degree span is ~370 m; the resulting error is dwarfed by
# the simplification above, and it is what makes the arcs compress.
DEFAULT_QUANTIZE = 3e3


def build(simplify: float, quantize: float) -> dict:
    """Return the TopoJSON topology for the CA tracts, keyed by GEOID."""
    import topojson as tp

    with tract_boundaries() as gdf:
        topo = tp.Topology(
            gdf,
            object_name="tracts",
            # High prequantize: the delta-encoding happens before
            # simplification, so a coarse grid here would round vertices away
            # before the simplifier gets to choose which ones matter.
            prequantize=1e6,
            toposimplify=simplify,
            topoquantize=quantize,
        )
        topology = json.loads(topo.to_json())

    geometries = topology["objects"]["tracts"]["geometries"]
    for g in geometries:
        # The GEOID is the only attribute, so carry it as the TopoJSON `id`
        # (which topojson-client copies onto feature.id) rather than a
        # one-key `properties` object. Saves ~250 KB across 9,109 tracts.
        g["id"] = g.pop("properties")["geoid"]

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
