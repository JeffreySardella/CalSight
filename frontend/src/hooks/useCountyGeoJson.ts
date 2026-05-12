import { useQuery } from "@tanstack/react-query";

export function useCountyGeoJson() {
  return useQuery<GeoJSON.FeatureCollection>({
    queryKey: ["ca-counties-geojson"],
    queryFn: async () => {
      const res = await fetch("/ca-counties.geojson");
      const data: GeoJSON.FeatureCollection = await res.json();
      data.features.sort((a, b) =>
        ((a.properties?.name ?? "") as string).localeCompare(
          (b.properties?.name ?? "") as string,
        ),
      );
      return data;
    },
    staleTime: Infinity,
  });
}
