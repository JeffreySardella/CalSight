import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import type { HeatmapResolution } from "./useLayersState";
import { slugify } from "./useFilterParams";

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

interface HeatmapParams {
  enabled: boolean;
  county: string | null;
  years: number[];
  severities: string[];
  causes: string[];
  alcohol?: boolean | null;
  distracted?: boolean | null;
  resolution: HeatmapResolution;
}

interface HeatmapApiResponse {
  points: HeatmapPoint[];
  total_crashes: number;
}

function buildUrl(params: HeatmapParams): string {
  const sp = new URLSearchParams();
  if (params.county) sp.set("county", params.county);
  if (params.years.length) sp.set("year", params.years.join(","));
  if (params.severities.length) sp.set("severity", params.severities.map(slugify).join(","));
  if (params.causes.length) sp.set("cause", params.causes.join(","));
  if (params.alcohol != null) sp.set("alcohol", String(params.alcohol));
  if (params.distracted != null) sp.set("distracted", String(params.distracted));
  sp.set("resolution", params.resolution);
  return `${API_BASE}/api/crashes/heatmap?${sp.toString()}`;
}

async function fetchHeatmap(params: HeatmapParams): Promise<HeatmapApiResponse> {
  const res = await fetch(buildUrl(params));
  if (!res.ok) throw new Error(`heatmap ${res.status}`);
  return res.json();
}

export function useCrashHeatmap(params: HeatmapParams) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "crashHeatmap",
      params.county,
      params.years,
      params.severities,
      params.causes,
      params.alcohol,
      params.distracted,
      params.resolution,
    ],
    queryFn: () => fetchHeatmap(params),
    enabled: params.enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    points: data?.points ?? [],
    totalCrashes: data?.total_crashes ?? 0,
    isLoading,
    error,
  };
}
