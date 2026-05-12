import { useQuery } from "@tanstack/react-query";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

export function useCountyGeoJson() {
  return useQuery<GeoJSON.FeatureCollection>({
    queryKey: ["ca-counties-geojson"],
    queryFn: async () => {
      const res = await fetch("/ca-counties.topo.json");
      const topology: Topology = await res.json();
      const geojson = feature(
        topology,
        topology.objects.counties as GeometryCollection,
      ) as unknown as GeoJSON.FeatureCollection;
      geojson.features.sort((a, b) =>
        ((a.properties?.name ?? "") as string).localeCompare(
          (b.properties?.name ?? "") as string,
        ),
      );
      return geojson;
    },
    staleTime: Infinity,
  });
}
