import { useQuery } from "@tanstack/react-query";

/**
 * Loads the static California highway centerline geometry
 * (frontend/public/ca-highways.geojson) once and caches it forever — the
 * geometry is a build-time artifact and never changes at runtime.
 *
 * Mirrors useCountyGeoJson; the highway file is plain GeoJSON (one Feature
 * per canonical route, `properties.route_number`).
 *
 * `enabled` is the Highways layer toggle: the file is 219 KB and the layer is
 * off by default, so fetching it on mount cost every first map view a
 * download nobody looked at.
 */
export function useHighwayGeoJson(enabled = true) {
  return useQuery<GeoJSON.FeatureCollection>({
    queryKey: ["ca-highways-geojson"],
    queryFn: async () => {
      const res = await fetch("/ca-highways.geojson");
      if (!res.ok) throw new Error(`highway geojson ${res.status}`);
      return res.json();
    },
    staleTime: Infinity,
    enabled,
  });
}
