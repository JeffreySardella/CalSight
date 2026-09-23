import L from "leaflet";
import { formatCompact } from "../../lib/formatCompact";

/**
 * Bounds of the named counties in the county GeoJSON, or null when none of
 * them is in it. What the map frames after a county is picked in the filter
 * sheet — the sheet ticked Fresno and left the camera on the whole state.
 */
export function countyBounds(
  geojson: GeoJSON.FeatureCollection,
  names: Iterable<string>,
): L.LatLngBounds | null {
  const wanted = new Set(names);
  const features = geojson.features.filter((f) => wanted.has(String(f.properties?.name ?? "")));
  if (features.length === 0) return null;
  return L.geoJSON({ type: "FeatureCollection", features } as GeoJSON.FeatureCollection).getBounds();
}

/**
 * The heat layer's coverage line, wherever it is printed: crashes it plots
 * (the ones carrying coordinates) out of every crash in the same scope and
 * filters. It used to print heat grid *cells* — over the county total in one
 * place ("20K mapped (9%)"), over plotted crashes in another ("20K of 107K").
 */
export function mappedLabel(mapped: number, scopeTotal: number | null | undefined): string {
  if (!scopeTotal) return `${formatCompact(mapped, 0)} crashes mapped`;
  const pct = Math.min(100, Math.round((mapped / scopeTotal) * 100));
  return `${formatCompact(mapped, 0)} of ${formatCompact(scopeTotal, 0)} crashes mapped (${pct}%)`;
}

/**
 * Crashes in the named counties, summed from the per-county counts the
 * choropleth already fetched (same filters, so it matches the map). Null
 * while any of them is missing — a partial sum would understate the total.
 */
export function countyCrashTotal(
  names: readonly string[],
  nameToCode: Record<string, number>,
  byCountyCode: Record<number, { rawCount: number }>,
): number | null {
  let total = 0;
  for (const name of names) {
    const code = nameToCode[name];
    const point = code != null ? byCountyCode[code] : undefined;
    if (!point) return null;
    total += point.rawCount;
  }
  return total;
}
