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
  /** Severity-weighted score (fatal×100 + injury×10 + pdo×1). */
  severity_score: number;
  killed: number;
  injured: number;
  latitude: number | null;
  longitude: number | null;
}

export type StreetScope = "intersections" | "corridors";
export type StreetSort = "count" | "severity";

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
  /** Rank by raw crash count (default) or severity-weighted score. */
  sort?: StreetSort;
  enabled?: boolean;
}

function buildUrl(params: StreetAggParams): string {
  const { scope, county, yearStart, yearEnd, minCrashes, limit, pedestrian, cyclist, sort } = params;
  const p = new URLSearchParams();
  if (county) p.set("county", county);
  if (yearStart != null) p.set("year_start", String(yearStart));
  if (yearEnd != null) p.set("year_end", String(yearEnd));
  if (minCrashes != null) p.set("min_crashes", String(minCrashes));
  if (limit != null) p.set("limit", String(limit));
  if (pedestrian) p.set("pedestrian", "true");
  if (cyclist) p.set("cyclist", "true");
  if (sort && sort !== "count") p.set("sort", sort);
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
    sort = "count",
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
      sort,
    ],
    queryFn: async () => {
      const res = await fetch(buildUrl({ scope, county, yearStart, yearEnd, minCrashes, limit, pedestrian, cyclist, sort }));
      if (!res.ok) throw new Error(`${scope} ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

// ── Street concentration (High-Injury-Network-style) ───────────────────

export interface ConcentrationBreakpoint {
  label: string;
  top_pct: number;
  unit_count: number;
  severe_share_pct: number;
}

export interface StreetConcentration {
  scope: StreetScope;
  county_code: number | null;
  county_name: string | null;
  total_units: number;
  total_crashes: number;
  total_severe_crashes: number;
  breakpoints: ConcentrationBreakpoint[];
}

export interface ConcentrationParams {
  scope: StreetScope;
  county?: string | null;
  yearStart?: number | null;
  yearEnd?: number | null;
  enabled?: boolean;
}

/**
 * How concentrated fatal+injury crashes are across crash-carrying streets —
 * the "top X% of streets hold Y% of severe crashes" statistic.
 */
export function useStreetConcentration(params: ConcentrationParams) {
  const { scope, county = null, yearStart = null, yearEnd = null, enabled = true } = params;
  return useQuery<StreetConcentration>({
    queryKey: ["street-concentration", scope, county, yearStart, yearEnd],
    queryFn: async () => {
      const p = new URLSearchParams({ scope });
      if (county) p.set("county", county);
      if (yearStart != null) p.set("year_start", String(yearStart));
      if (yearEnd != null) p.set("year_end", String(yearEnd));
      const res = await fetch(`${API_BASE}/api/street-concentration?${p.toString()}`);
      if (!res.ok) throw new Error(`street-concentration ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
