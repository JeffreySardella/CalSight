import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../config";
import type { HeatmapResolution } from "./useLayersState";
import { slugify, formatYearMonth, type DateRangeFilter } from "./useFilterParams";

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
  severity?: string | null;
  collision_id?: number | null;
  data_source?: string | null;
  crash_datetime?: string | null;
  canonical_cause?: string | null;
  weather?: string | null;
  lighting?: string | null;
  number_killed?: number | null;
  number_injured?: number | null;
  primary_road?: string | null;
  hit_run?: string | null;
}

interface HeatmapParams {
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
  resolution: HeatmapResolution;
  mismatchOnly?: boolean;
  includeRivers?: boolean;
  batch?: number;
  batchSize?: number;
  _retryKey?: number;
}

function dateRangeKey(dr: DateRangeFilter | null): string {
  if (!dr) return "";
  return `${dr.start ? formatYearMonth(dr.start) : ""}|${dr.end ? formatYearMonth(dr.end) : ""}`;
}

interface HeatmapApiResponse {
  points: HeatmapPoint[];
  total_crashes: number;
  batch: number | null;
  total_batches: number | null;
}

function buildUrl(params: HeatmapParams): string {
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
  sp.set("resolution", params.resolution);
  if (params.mismatchOnly) sp.set("mismatch_only", "true");
  if (params.includeRivers) sp.set("include_rivers", "true");
  if (params.batch) sp.set("batch", String(params.batch));
  if (params.batchSize) sp.set("batch_size", String(params.batchSize));
  return `${API_BASE}/api/crashes/heatmap?${sp.toString()}`;
}

export const FETCH_TIMEOUT_MS = 15_000;

async function fetchHeatmap(params: HeatmapParams): Promise<HeatmapApiResponse> {
  const res = await fetch(buildUrl(params), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`heatmap ${res.status}`);
  return res.json();
}

export function useCrashHeatmap(params: HeatmapParams) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      "crashHeatmap",
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
      params.resolution,
      params.mismatchOnly ?? false,
      params.includeRivers ?? false,
      params.batch ?? null,
      params.batchSize ?? null,
      params._retryKey ?? 0,
    ],
    queryFn: () => fetchHeatmap(params),
    enabled: params.enabled,
    staleTime: 5 * 60 * 1000,
    // Explicitly short: each batch is up to 150k points × 15 fields, keyed per
    // filter permutation. These must be collected promptly after unmount (H7)
    // regardless of what the global default is set to.
    gcTime: 5 * 60 * 1000,
  });

  return {
    points: data?.points ?? [],
    totalCrashes: data?.total_crashes ?? 0,
    batch: data?.batch ?? null,
    totalBatches: data?.total_batches ?? null,
    isLoading,
    error,
    refetch,
  };
}

// Hard ceiling on accumulated heatmap points for a single county view. A
// dense county (e.g. Los Angeles) can return several million rows; holding
// them all means multi-GB arrays, O(total) rebuilds per batch, and a full
// rescan of the array on every pan. This many points already saturate the
// heatmap's visual density and the dot layer is viewport-culled to ≤800, so
// past this bound extra points cost memory and main-thread time for no
// visible gain. When we hit it we stop fetching further batches and surface
// `capped` so the UI can say it's showing a sample rather than looking stuck.
export const MAX_HEATMAP_POINTS = 600_000;

export function useBatchedHeatmap(params: Omit<HeatmapParams, "batch" | "batchSize"> & { batchSize?: number }) {
  const size = params.batchSize ?? 150_000;
  const [currentBatch, setCurrentBatch] = useState(1);
  const [allPoints, setAllPoints] = useState<HeatmapPoint[]>([]);
  // Highest batch number already folded into allPoints. Advancement waits on
  // this so we never request batch N+1 before batch N is accounted for —
  // otherwise the cap check (below) races the accumulation and lets one extra
  // batch through.
  const [loadedUpTo, setLoadedUpTo] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const capped = allPoints.length >= MAX_HEATMAP_POINTS;

  const { points, totalCrashes, batch, totalBatches, isLoading, error } = useCrashHeatmap({
    ...params,
    batch: currentBatch,
    batchSize: size,
    _retryKey: retryKey,
  });

  const filterKey = `${params.county}|${dateRangeKey(params.dateRange)}|${params.severities.join(",")}|${params.causes.join(",")}|${params.resolution}|${params.mismatchOnly ?? ""}|${params.includeRivers ?? ""}|${params.alcohol ?? ""}|${params.distracted ?? ""}|${params.pedestrian ?? ""}|${params.cyclist ?? ""}|${params.drug ?? ""}|${params.driverAge ?? ""}|${(params.weather ?? []).join(",")}|${(params.lighting ?? []).join(",")}|${(params.collisionType ?? []).join(",")}|${params.roadType ?? ""}|${params.hitRun ?? ""}`;
  useEffect(() => {
    setCurrentBatch(1);
    setAllPoints([]);
    setLoadedUpTo(0);
  }, [filterKey]);

  // Fold each completed batch into the accumulator and mark it loaded. Runs
  // for empty batches too (points can be legitimately empty) so advancement
  // isn't stalled. `batch === currentBatch` ensures the response belongs to
  // the batch we asked for.
  useEffect(() => {
    if (!isLoading && !error && batch === currentBatch && loadedUpTo < currentBatch) {
      if (points.length > 0) {
        setAllPoints((prev) => {
          if (currentBatch === 1) return points.slice(0, MAX_HEATMAP_POINTS);
          if (prev.length >= MAX_HEATMAP_POINTS) return prev;
          const remaining = MAX_HEATMAP_POINTS - prev.length;
          // concat (not [...prev, ...points]) avoids spreading a multi-million
          // element array into a fresh literal on every batch.
          return prev.concat(remaining >= points.length ? points : points.slice(0, remaining));
        });
      }
      setLoadedUpTo(currentBatch);
    }
  }, [points, batch, currentBatch, loadedUpTo, isLoading, error]);

  // Auto-advance once the current batch is folded in and batches remain. Stop
  // on error, completion, or once we've hit the accumulation cap (fetching
  // further batches would just discard them). Gating on loadedUpTo (not the
  // raw response) keeps the cap check from racing the accumulation.
  useEffect(() => {
    if (!capped && loadedUpTo === currentBatch && totalBatches && currentBatch < totalBatches) {
      setCurrentBatch((b) => b + 1);
    }
  }, [capped, loadedUpTo, totalBatches, currentBatch]);

  const loadNextBatch = useCallback(() => {
    if (totalBatches && currentBatch < totalBatches) {
      setCurrentBatch((b) => b + 1);
    }
  }, [currentBatch, totalBatches]);

  const retry = useCallback(() => {
    setRetryKey((k) => k + 1);
  }, []);

  return {
    points: allPoints,
    totalCrashes,
    currentBatch,
    totalBatches,
    // Once capped we stop advancing, so there's no "more" to load.
    hasMore: !capped && totalBatches != null && currentBatch < totalBatches,
    capped,
    loadNextBatch,
    retry,
    isLoading,
    error,
  };
}
