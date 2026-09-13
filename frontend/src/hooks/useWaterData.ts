import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";

export interface ReservoirCondition {
  station_id: string;
  name: string;
  capacity_af: number;
  county_code: number | null;
  /** Station coordinates (CDEC staMeta). Null for rows loaded before the
   *  coordinate columns existed — the map layer skips those. */
  lat: number | null;
  lon: number | null;
  latest_date: string;
  storage_af: number;
  pct_of_capacity: number;
  avg_storage_af: number | null;
  pct_of_average: number | null;
  /** Normal period the percent-of-average is measured against, e.g. "1991-2020".
   *  Null when no percent is shown. */
  baseline_period?: string | null;
}

/** Most common non-null baseline_period in a payload, or null. Sections
 *  footnote the baseline once rather than per card. */
export function commonBaseline(periods: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const p of periods) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Footnote phrase for what "average" means: the reported normal period
 *  (DWR's climatological normal) or the legacy all-loaded-years mean. */
export function baselineNote(period: string | null | undefined): string {
  return period
    ? `the ${period.replace("-", "–")} mean for this calendar day (DWR’s climatological normal)`
    : "the mean for this calendar day across all loaded years";
}

/** Footnote for a whole station set: the common period's note, and — when
 *  the set is not uniform — how many stations fall back to their shorter
 *  period of record, so one footnote never misdescribes those cards. */
export function baselineFootnote(periods: (string | null | undefined)[]): string {
  const common = commonBaseline(periods);
  const n = periods.filter((p) => p && p !== common).length;
  if (n === 0) return baselineNote(common);
  return `${baselineNote(common)}; ${n === 1 ? "1 station uses its" : `${n} stations use their`} shorter full record`;
}

export interface ReservoirSeriesPoint {
  date: string;
  storage_af: number;
}

export interface ReservoirSeries {
  station_id: string;
  name: string;
  capacity_af: number;
  points: ReservoirSeriesPoint[];
}

export function formatAcreFeet(af: number): string {
  // 999,500+ would round to "1000K" — promote to the M format instead.
  if (af >= 999_500) return `${(af / 1_000_000).toFixed(2)}M`;
  if (af >= 1_000) return `${Math.round(af / 1_000)}K`;
  return Math.round(af).toLocaleString();
}

export interface StatewideSummary {
  totalStorageAf: number;
  totalCapacityAf: number;
  pctOfCapacity: number;
  /** Storage-weighted percent of historical average, null until enough history. */
  pctOfAverage: number | null;
}

export function summarize(reservoirs: ReservoirCondition[]): StatewideSummary | null {
  if (!reservoirs.length) return null;
  const totalStorageAf = reservoirs.reduce((s, r) => s + r.storage_af, 0);
  const totalCapacityAf = reservoirs.reduce((s, r) => s + r.capacity_af, 0);

  const withAvg = reservoirs.filter((r) => r.avg_storage_af !== null);
  const avgTotal = withAvg.reduce((s, r) => s + (r.avg_storage_af as number), 0);
  const storageWithAvg = withAvg.reduce((s, r) => s + r.storage_af, 0);

  return {
    totalStorageAf,
    totalCapacityAf,
    pctOfCapacity: (totalStorageAf / totalCapacityAf) * 100,
    pctOfAverage: avgTotal > 0 ? (storageWithAvg / avgTotal) * 100 : null,
  };
}

export function useReservoirConditions(enabled = true) {
  return useQuery<ReservoirCondition[]>({
    queryKey: ["water", "reservoirs"],
    enabled,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/water/reservoirs`);
      if (!res.ok) throw new Error(`water/reservoirs ${res.status}`);
      return res.json();
    },
    // Backend Cache-Control is one hour; storage moves daily at most.
    staleTime: 60 * 60 * 1000,
  });
}

export function useReservoirSeries(stationId: string | null, days = 365) {
  return useQuery<ReservoirSeries>({
    queryKey: ["water", "series", stationId, days],
    enabled: stationId !== null,
    queryFn: async () => {
      const start = new Date();
      start.setDate(start.getDate() - days);
      // Only a lower bound — an explicit `end` computed client-side (UTC vs
      // local "today") can lag a day and clip the newest reading.
      const params = new URLSearchParams({
        start: start.toISOString().slice(0, 10),
      });
      const res = await fetch(
        `${API_BASE}/api/water/reservoirs/${stationId}/series?${params}`,
      );
      if (!res.ok) throw new Error(`water/series ${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });
}
