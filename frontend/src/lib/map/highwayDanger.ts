import type { HighwayRow, HighwaySort } from "../../hooks/useHighwayRankings";
import { quantileBuckets, bucketFor } from "../choropleth/binning";

/**
 * A highway geometry feature joined to its danger value and resolved color.
 *
 * This is the rendering contract for the map layer. v1 produces one
 * DangerFeature per whole route; a future per-segment phase produces many
 * per route — the layer renders them identically, only the source changes.
 */
export interface DangerFeature {
  route_number: string;
  geometry: GeoJSON.Geometry;
  value: number | null;
  color: string;
  row: HighwayRow | null;
}

/**
 * Left-join highway geometry to danger rows by route_number and resolve a
 * line color per feature.
 *
 * - `value` is `row[metric]`, or null when the route has no crashes in the
 *   current filter, or the metric itself is null (e.g. crashes_per_mile with
 *   unknown miles).
 * - Color comes from quantile buckets over the non-null values. With too few
 *   routes to bucket (< MIN_BUCKET_SUBSET), routes with a value get the top
 *   color (they still read as "has crashes"), not the no-data color.
 * - `colors` is the already-resolved palette (caller does getPalette + theme).
 */
export function buildDangerFeatures(
  geo: GeoJSON.FeatureCollection,
  rows: HighwayRow[],
  metric: HighwaySort,
  colors: readonly string[],
  noDataColor: string,
): DangerFeature[] {
  const byRoute = new Map(rows.map((r) => [r.route_number, r]));
  const values = rows
    .map((r) => r[metric])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const edges = quantileBuckets(values, colors.length);

  return geo.features.map((f) => {
    const id = String(f.properties?.route_number ?? "");
    const row = byRoute.get(id) ?? null;
    const raw = row ? row[metric] : null;
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;

    let color = noDataColor;
    if (value !== null) {
      color = edges ? colors[bucketFor(value, edges)] : colors[colors.length - 1];
    }

    return {
      route_number: id,
      geometry: f.geometry as GeoJSON.Geometry,
      value,
      color,
      row,
    };
  });
}
