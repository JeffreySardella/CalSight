type Position = [number, number];
type Ring = Position[];

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, coords: Position[][]): boolean {
  if (!pointInRing(lng, lat, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(lng, lat, coords[i])) return false;
  }
  return true;
}

function pointInMultiPolygon(lng: number, lat: number, coords: Position[][][]): boolean {
  return coords.some((poly) => pointInPolygon(lng, lat, poly));
}

export function findCountyAtPoint(
  lat: number,
  lng: number,
  geojson: GeoJSON.FeatureCollection,
): string | null {
  for (const feature of geojson.features) {
    const geom = feature.geometry;
    const coords = (geom as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates;
    const hit =
      geom.type === "Polygon"
        ? pointInPolygon(lng, lat, coords as Position[][])
        : geom.type === "MultiPolygon"
          ? pointInMultiPolygon(lng, lat, coords as Position[][][])
          : false;
    if (hit) return (feature.properties?.name ?? null) as string | null;
  }
  return null;
}
