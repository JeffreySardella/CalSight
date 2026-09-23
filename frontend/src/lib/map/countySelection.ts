import L from "leaflet";

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
