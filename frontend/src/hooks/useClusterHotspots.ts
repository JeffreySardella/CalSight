import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { slugify, formatYearMonth, type DateRangeFilter } from "./useFilterParams";

export interface ClusterSeverityBreakdown {
  fatal: number;
  injury: number;
  pdo: number;
}

export interface ClusterPoint {
  lat: number;
  lng: number;
  crash_count: number;
  z_score: number;
  severity: ClusterSeverityBreakdown;
}

interface ClusterHotspotsParams {
  enabled: boolean;
  county: string | null;
  dateRange: DateRangeFilter | null;
  severities: string[];
  causes: string[];
  alcohol?: boolean | null;
  distracted?: boolean | null;
  pedestrian?: boolean | null;
  cyclist?: boolean | null;
  drug?: boolean | null;
  driverAge?: string | null;
  weather?: string[];
  lighting?: string[];
  collisionType?: string[];
  roadType?: string | null;
  hitRun?: boolean;
}

interface ClusterHotspotsApiResponse {
  clusters: ClusterPoint[];
  total_grid_cells: number;
  mean_count: number;
  stddev_count: number;
  threshold: number;
}

function dateRangeKey(dr: DateRangeFilter | null): string {
  if (!dr) return "";
  return `${dr.start ? formatYearMonth(dr.start) : ""}|${dr.end ? formatYearMonth(dr.end) : ""}`;
}

function buildUrl(params: ClusterHotspotsParams): string {
  const sp = new URLSearchParams();
  if (params.county) sp.set("county", params.county);
  if (params.dateRange?.start) sp.set("start", formatYearMonth(params.dateRange.start));
  if (params.dateRange?.end) sp.set("end", formatYearMonth(params.dateRange.end));
  if (params.severities.length) sp.set("severity", params.severities.map(slugify).join(","));
  if (params.causes.length) sp.set("cause", params.causes.join(","));
  if (params.alcohol != null) sp.set("alcohol", String(params.alcohol));
  if (params.distracted != null) sp.set("distracted", String(params.distracted));
  if (params.pedestrian != null) sp.set("pedestrian", String(params.pedestrian));
  if (params.cyclist != null) sp.set("cyclist", String(params.cyclist));
  if (params.drug != null) sp.set("drug", String(params.drug));
  if (params.driverAge) sp.set("driver_age", params.driverAge);
  if (params.weather?.length) sp.set("weather", params.weather.join(","));
  if (params.lighting?.length) sp.set("lighting", params.lighting.join(","));
  if (params.collisionType?.length) sp.set("collision_type", params.collisionType.join(","));
  if (params.roadType) sp.set("road_type", params.roadType);
  if (params.hitRun) sp.set("hit_run", "true");
  return `${API_BASE}/api/crashes/clusters?${sp.toString()}`;
}

export const FETCH_TIMEOUT_MS = 15_000;

async function fetchClusterHotspots(params: ClusterHotspotsParams): Promise<ClusterHotspotsApiResponse> {
  const res = await fetch(buildUrl(params), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`clusters ${res.status}`);
  return res.json();
}

export function useClusterHotspots(params: ClusterHotspotsParams) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "crashClusters",
      params.county,
      dateRangeKey(params.dateRange),
      params.severities,
      params.causes,
      params.alcohol,
      params.distracted,
      params.pedestrian,
      params.cyclist,
      params.drug,
      params.driverAge,
      params.weather ?? [],
      params.lighting ?? [],
      params.collisionType ?? [],
      params.roadType ?? null,
      params.hitRun ?? false,
    ],
    queryFn: () => fetchClusterHotspots(params),
    enabled: params.enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    clusters: data?.clusters ?? [],
    totalGridCells: data?.total_grid_cells ?? 0,
    meanCount: data?.mean_count ?? 0,
    stddevCount: data?.stddev_count ?? 0,
    threshold: data?.threshold ?? 0,
    isLoading,
    error,
  };
}
