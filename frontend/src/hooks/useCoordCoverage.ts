import { useQuery } from "@tanstack/react-query";
import { YEARS, yearsInRange, type DateRangeFilter } from "./useFilterParams";
import { API_BASE } from "../config";

export type DataQualityRow = {
  county_code: number | null;
  year: number | null;
  total_crashes: number | null;
  crashes_with_coords: number | null;
};

export type CoordCoverage = {
  mapped: number;
  total: number;
  pct: number;
};

/** The one /api/data-quality fetch, shared by this hook and the choropleth's
 *  coord_coverage measure (useChoroplethData) — same key, so selecting the
 *  measure costs no extra request. The response carries every scope (county x
 *  year, statewide per year, county all-time); each caller picks its own. */
export const DATA_QUALITY_QUERY = {
  queryKey: ["data-quality-statewide"] as const,
  queryFn: async (): Promise<DataQualityRow[]> => {
    const res = await fetch(`${API_BASE}/api/data-quality`);
    if (!res.ok) throw new Error("data-quality fetch failed");
    const body = await res.json();
    // A non-array body (an error envelope from a proxy, say) used to reach
    // `.filter` below and throw during render, blanking the whole map behind
    // the error boundary over a strictly optional coverage figure.
    if (!Array.isArray(body)) throw new Error("data-quality: expected an array");
    return body;
  },
  staleTime: 5 * 60 * 1000,
};

/** Located vs total crashes per county over `dateRange` (empty = all years),
 *  summed from the per-county-per-year rows. */
export function coordCoverageByCounty(
  rows: DataQualityRow[] | undefined,
  dateRange: DateRangeFilter | null,
): Map<number, { withCoords: number; total: number }> {
  const out = new Map<number, { withCoords: number; total: number }>();
  if (!rows) return out;

  const yearSet = yearsInRange(dateRange);
  const allYears = yearSet.size === 0 || yearSet.size === YEARS.length;

  for (const r of rows) {
    if (r.county_code == null || r.year == null) continue;
    if (!allYears && !yearSet.has(r.year)) continue;
    const prev = out.get(r.county_code) ?? { withCoords: 0, total: 0 };
    prev.withCoords += r.crashes_with_coords ?? 0;
    prev.total += r.total_crashes ?? 0;
    out.set(r.county_code, prev);
  }
  return out;
}

export function useCoordCoverage(dateRange: DateRangeFilter | null): CoordCoverage | null {
  const { data } = useQuery<DataQualityRow[]>(DATA_QUALITY_QUERY);

  if (!data) return null;

  // Only statewide per-year rows (county_code null, year present)
  const statewide = data.filter((r) => r.county_code === null && r.year !== null);

  const yearSet = yearsInRange(dateRange);
  const allYears = yearSet.size === 0 || yearSet.size === YEARS.length;
  const rows = allYears ? statewide : statewide.filter((r) => yearSet.has(r.year!));

  if (!rows.length) return null;

  const mapped = rows.reduce((s, r) => s + (r.crashes_with_coords ?? 0), 0);
  const total = rows.reduce((s, r) => s + (r.total_crashes ?? 0), 0);

  if (total === 0) return null;
  return { mapped, total, pct: (mapped / total) * 100 };
}
