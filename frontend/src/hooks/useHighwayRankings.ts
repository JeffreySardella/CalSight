import { useQuery } from "@tanstack/react-query";
import { formatYearMonth, type DateRangeFilter } from "./useFilterParams";
import { API_BASE } from "../config";
import type { StatsFilters } from "./useStats";

export interface HighwayRow {
  route_number: string;
  crash_count: number;
  total_killed: number;
  total_injured: number;
  fatality_rate: number;
  miles: number | null;
  crashes_per_mile: number | null;
}

export type HighwaySort = "crash_count" | "fatality_rate" | "crashes_per_mile";

const SEVERITY_SLUG: Record<string, string> = {
  Fatal: "fatal",
  Injury: "injury",
  "Property Damage Only": "property-damage-only",
};

function buildUrl(filters: StatsFilters, sort: HighwaySort, limit: number): string {
  const p = new URLSearchParams();
  const dr: DateRangeFilter | null = filters.dateRange;
  if (dr?.start) p.set("start", formatYearMonth(dr.start));
  if (dr?.end) p.set("end", formatYearMonth(dr.end));
  if (filters.severities.length) {
    p.set("severity", filters.severities.map((s) => SEVERITY_SLUG[s] ?? s).join(","));
  }
  if (filters.causes.length) p.set("cause", filters.causes.join(","));
  if (filters.counties.length) p.set("county", filters.counties.join(","));
  if (filters.alcohol) p.set("alcohol", "true");
  if (filters.pedestrian) p.set("pedestrian", "true");
  if (filters.cyclist) p.set("cyclist", "true");
  if (filters.drug) p.set("drug", "true");
  if (filters.distracted) p.set("distracted", "true");
  if (filters.driverAge) p.set("driver_age", filters.driverAge);
  if (filters.weather) p.set("weather", filters.weather);
  if (filters.lighting) p.set("lighting", filters.lighting);
  if (filters.collisionType) p.set("collision_type", filters.collisionType);
  if (filters.roadType) p.set("road_type", filters.roadType);
  if (filters.hitRun) p.set("hit_run", "true");
  p.set("sort", sort);
  p.set("limit", String(limit));
  return `${API_BASE}/api/stats/highways?${p.toString()}`;
}

export function useHighwayRankings(
  filters: StatsFilters,
  sort: HighwaySort = "crash_count",
  limit = 20,
) {
  const url = buildUrl(filters, sort, limit);
  return useQuery<HighwayRow[]>({
    queryKey: ["highway-rankings", url],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`highways ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
