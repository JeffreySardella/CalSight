import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../config";
import type { HeatmapResolution } from "./useLayersState";
import { slugify } from "./useFilterParams";

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
  severity?: string | null;
}

interface HeatmapParams {
  enabled: boolean;
  county: string | null;
  years: number[];
  severities: string[];
  causes: string[];
  alcohol?: boolean | null;
  distracted?: boolean | null;
  pedestrian?: boolean | null;
  cyclist?: boolean | null;
  drug?: boolean | null;
  driverAge?: string | null;
  resolution: HeatmapResolution;
  mismatchOnly?: boolean;
  includeRivers?: boolean;
  batch?: number;
  batchSize?: number;
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
  if (params.years.length) sp.set("year", params.years.join(","));
  if (params.severities.length) sp.set("severity", params.severities.map(slugify).join(","));
  if (params.causes.length) sp.set("cause", params.causes.join(","));
  if (params.alcohol != null) sp.set("alcohol", String(params.alcohol));
  if (params.distracted != null) sp.set("distracted", String(params.distracted));
  if (params.pedestrian != null) sp.set("pedestrian", String(params.pedestrian));
  if (params.cyclist != null) sp.set("cyclist", String(params.cyclist));
  if (params.drug != null) sp.set("drug", String(params.drug));
  if (params.driverAge) sp.set("driver_age", params.driverAge);
  sp.set("resolution", params.resolution);
  if (params.mismatchOnly) sp.set("mismatch_only", "true");
  if (params.includeRivers) sp.set("include_rivers", "true");
  if (params.batch) sp.set("batch", String(params.batch));
  if (params.batchSize) sp.set("batch_size", String(params.batchSize));
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
      params.pedestrian,
      params.cyclist,
      params.drug,
      params.driverAge,
      params.resolution,
      params.mismatchOnly ?? false,
      params.includeRivers ?? false,
      params.batch ?? null,
      params.batchSize ?? null,
    ],
    queryFn: () => fetchHeatmap(params),
    enabled: params.enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    points: data?.points ?? [],
    totalCrashes: data?.total_crashes ?? 0,
    batch: data?.batch ?? null,
    totalBatches: data?.total_batches ?? null,
    isLoading,
    error,
  };
}

export function useBatchedHeatmap(params: Omit<HeatmapParams, "batch" | "batchSize"> & { batchSize?: number }) {
  const size = params.batchSize ?? 1_100_000;
  const [currentBatch, setCurrentBatch] = useState(1);
  const [allPoints, setAllPoints] = useState<HeatmapPoint[]>([]);

  const { points, totalCrashes, batch, totalBatches, isLoading, error } = useCrashHeatmap({
    ...params,
    batch: currentBatch,
    batchSize: size,
  });

  const filterKey = `${params.county}|${params.years.join(",")}|${params.severities.join(",")}|${params.causes.join(",")}|${params.resolution}|${params.mismatchOnly ?? ""}|${params.includeRivers ?? ""}`;
  useEffect(() => {
    setCurrentBatch(1);
    setAllPoints([]);
  }, [filterKey]);

  useEffect(() => {
    if (points.length > 0 && batch === currentBatch) {
      setAllPoints((prev) => currentBatch === 1 ? points : [...prev, ...points]);
    }
  }, [points, batch, currentBatch, filterKey]);

  // Auto-load next batch when current one finishes
  useEffect(() => {
    if (!isLoading && totalBatches && currentBatch < totalBatches && points.length > 0) {
      setCurrentBatch((b) => b + 1);
    }
  }, [isLoading, totalBatches, currentBatch, points.length]);

  const loadNextBatch = useCallback(() => {
    if (totalBatches && currentBatch < totalBatches) {
      setCurrentBatch((b) => b + 1);
    }
  }, [currentBatch, totalBatches]);

  return {
    points: allPoints,
    totalCrashes,
    currentBatch,
    totalBatches,
    hasMore: totalBatches != null && currentBatch < totalBatches,
    loadNextBatch,
    isLoading,
    error,
  };
}
