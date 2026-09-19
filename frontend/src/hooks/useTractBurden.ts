import { useQuery } from "@tanstack/react-query";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { API_BASE } from "../config";
import { yearsInRange, type DateRangeFilter } from "./useFilterParams";
import type { TractBurden } from "../lib/map/tractBurden";

export type {
  TractBurden,
  TractBurdenRow,
  TractBurdenSummary,
} from "../lib/map/tractBurden";

/**
 * The CA census tract outlines, as a static TopoJSON asset (same pattern as
 * useCountyGeoJson). ~1.4 MB raw / ~356 KB gzip — deliberately not in the
 * service-worker precache, and `enabled` keeps it off the wire until someone
 * actually turns the layer on.
 *
 * The GEOID rides on the TopoJSON `id`, not in `properties` — one string per
 * tract instead of a wrapper object saved ~250 KB.
 */
export function useTractGeoJson(enabled: boolean) {
  return useQuery<GeoJSON.FeatureCollection>({
    queryKey: ["ca-tracts-geojson"],
    enabled,
    queryFn: async () => {
      const res = await fetch("/ca-tracts.topo.json");
      if (!res.ok) throw new Error(`ca-tracts.topo.json ${res.status}`);
      const topology: Topology = await res.json();
      return feature(
        topology,
        topology.objects.tracts as GeometryCollection,
      ) as unknown as GeoJSON.FeatureCollection;
    },
    staleTime: Infinity,
  });
}

/** Per-tract crash burden + CES percentile for the selected years. */
export function useTractBurden(
  dateRange: DateRangeFilter | null,
  enabled: boolean,
) {
  const years = [...yearsInRange(dateRange)].sort((a, b) => a - b);
  const start = years.length ? years[0] : null;
  const end = years.length ? years[years.length - 1] : null;

  return useQuery<TractBurden>({
    queryKey: ["tract-burden", start, end],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (start != null) params.set("start", String(start));
      if (end != null) params.set("end", String(end));
      const qs = params.toString();
      const res = await fetch(
        `${API_BASE}/api/tract-burden${qs ? `?${qs}` : ""}`,
      );
      if (!res.ok) throw new Error(`tract-burden ${res.status}`);
      return res.json();
    },
    // Backend Cache-Control is a day; the aggregate only moves when the ETL
    // reruns.
    staleTime: 60 * 60 * 1000,
  });
}
