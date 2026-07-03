import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

/** One aggregated street-level location returned by /api/intersections or /api/corridors. */
export interface StreetAggRow {
  county_code: number;
  county_name: string | null;
  primary_road: string;
  /** Always null for corridors (single-road aggregation). */
  secondary_road: string | null;
  crash_count: number;
  fatal_count: number;
  injury_count: number;
  pdo_count: number;
  killed: number;
  injured: number;
  latitude: number | null;
  longitude: number | null;
}

export type StreetScope = "intersections" | "corridors";

export interface StreetAggParams {
  scope: StreetScope;
  /** County slug (e.g. "los-angeles"). Omit / null for statewide. */
  county?: string | null;
  yearStart?: number | null;
  yearEnd?: number | null;
  minCrashes?: number | null;
  limit?: number | null;
  /** Restrict to pedestrian-involved crashes. */
  pedestrian?: boolean;
  /** Restrict to bicyclist-involved crashes. */
  cyclist?: boolean;
  enabled?: boolean;
}

function buildUrl(params: StreetAggParams): string {
  const { scope, county, yearStart, yearEnd, minCrashes, limit, pedestrian, cyclist } = params;
  const p = new URLSearchParams();
  if (county) p.set("county", county);
  if (yearStart != null) p.set("year_start", String(yearStart));
  if (yearEnd != null) p.set("year_end", String(yearEnd));
  if (minCrashes != null) p.set("min_crashes", String(minCrashes));
  if (limit != null) p.set("limit", String(limit));
  if (pedestrian) p.set("pedestrian", "true");
  if (cyclist) p.set("cyclist", "true");
  const qs = p.toString();
  return `${API_BASE}/api/${scope}${qs ? `?${qs}` : ""}`;
}

/**
 * Fetch street-level crash aggregations, ranked by crash count.
 * `scope` selects intersections (primary × secondary road) or corridors
 * (single road). County is optional — omit for a statewide ranking.
 */
export function useStreetAggregation(params: StreetAggParams) {
  const {
    scope,
    county = null,
    yearStart = null,
    yearEnd = null,
    minCrashes = null,
    limit = null,
    pedestrian = false,
    cyclist = false,
    enabled = true,
  } = params;

  return useQuery<StreetAggRow[]>({
    // Stable key: every param that affects the request is part of the key.
    queryKey: [
      "street-aggregation",
      scope,
      county,
      yearStart,
      yearEnd,
      minCrashes,
      limit,
      pedestrian,
      cyclist,
    ],
    queryFn: async () => {
      const res = await fetch(buildUrl({ scope, county, yearStart, yearEnd, minCrashes, limit, pedestrian, cyclist }));
      if (!res.ok) throw new Error(`${scope} ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
