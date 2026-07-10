/**
 * useCountyInsight — fetches pre-computed AI insight data for a county.
 *
 * Calls GET /api/insights/{county_slug}?year={year} and returns the
 * structured stats + optional LLM narrative for the requested county.
 *
 * Graceful degradation:
 * - countyName null/undefined → query disabled, returns { data: null }
 * - API returns 404 → returns { data: null } (no error — county hasn't been
 *   processed yet or ETL hasn't run)
 * - narrative field null → caller hides the blurb; stats are still returned
 *
 * Cache: staleTime matches the API's Cache-Control: public, max-age=300.
 */

import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { PERSISTED_QUERY_GC_TIME } from "../lib/queryPersistence";
import { slugify } from "./useFilterParams";

export interface CountyInsightData {
  county_name: string;
  year: number;
  total_crashes: number | null;
  total_killed: number | null;
  total_injured: number | null;
  crash_rate_per_capita: number | null;
  top_cause: string | null;
  top_cause_pct: number | null;
  yoy_change_pct: number | null;
  peak_hour: number | null;
  dui_pct: number | null;
  /** LLM-generated narrative blurb. null when ETL hasn't run or LLM failed. */
  narrative: string | null;
  generated_at: string | null;
}

async function fetchInsight(
  slug: string,
  year?: number,
): Promise<CountyInsightData | null> {
  const params = year ? `?year=${year}` : "";
  const res = await fetch(`${API_BASE}/api/insights/${slug}${params}`);
  // 404 = county not yet processed — treat as "no data", not an error
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`insight fetch failed: ${res.status}`);
  return res.json();
}

export function useCountyInsight(
  countyName: string | null | undefined,
  year?: number,
): { data: CountyInsightData | null; isLoading: boolean; error: unknown } {
  const slug = countyName ? slugify(countyName) : null;

  const query = useQuery<CountyInsightData | null>({
    queryKey: ["insight", slug, year ?? null],
    queryFn: () => fetchInsight(slug!, year),
    enabled: !!slug,
    // 5 min — aligns with Cache-Control: public, max-age=300 on the API
    staleTime: 5 * 60 * 1000,
    // Persisted offline (queryPersistence.ts whitelist) — must outlive the
    // short global gcTime to keep feeding the snapshot.
    gcTime: PERSISTED_QUERY_GC_TIME,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
