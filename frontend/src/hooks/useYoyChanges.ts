import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export type YoyMetric = "crashes" | "fatal_crashes" | "killed" | "injured";

export interface CountyChange {
  county_code: number;
  county_name: string | null;
  current: number;
  previous: number;
  abs_change: number;
  /** Percent change vs the baseline year; null when the baseline is zero. */
  pct_change: number | null;
  /** Baseline below the metric's minimum — percent change is noise-prone. */
  small_baseline: boolean;
}

export interface YoyChanges {
  metric: YoyMetric;
  year: number;
  baseline_year: number;
  /** The comparison year is the current calendar year — data still accumulating. */
  partial_year: boolean;
  min_baseline: number;
  rows: CountyChange[];
}

export interface YoyParams {
  metric: YoyMetric;
  year?: number | null;
  enabled?: boolean;
}

/**
 * Per-county year-over-year change ranking for a metric. Rows arrive ranked
 * by |percent change| with small-baseline rows after solid-baseline ones.
 */
export function useYoyChanges(params: YoyParams) {
  const { metric, year = null, enabled = true } = params;
  return useQuery<YoyChanges>({
    queryKey: ["yoy-changes", metric, year],
    queryFn: async () => {
      const p = new URLSearchParams({ metric });
      if (year != null) p.set("year", String(year));
      const res = await fetch(`${API_BASE}/api/stats/yoy-changes?${p.toString()}`);
      if (!res.ok) throw new Error(`yoy-changes ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
