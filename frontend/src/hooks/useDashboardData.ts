import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { slotKey, type ChartSlot, type Dimension, type Measure } from "../lib/dashboard/types";
import type { StatsFilters } from "./useStats";
import { formatYearMonth } from "./useFilterParams";
import { movingAverage } from "../lib/dashboard/stats";
import type { DimensionRow, StatsBatchResponse } from "../types/api";

export type ChartDataItem = { label: string; value: number; color?: string; x?: number; y?: number };

const CAUSE_LABEL: Record<string, string> = {
  dui: "DUI", speeding: "Speeding", lane_change: "Lane Change",
  right_of_way: "Right of Way", turning: "Improper Turn",
  following_too_close: "Tailgating", signal_violation: "Signal Violation",
  pedestrian_violation: "Pedestrian", unsafe_backing: "Unsafe Backing",
  other: "Other", uncategorized: "Uncategorized",
};

const AGE_LABEL: Record<string, string> = {
  under_18: "Under 18", "18_24": "18–24", "25_44": "25–44",
  "45_64": "45–64", over_65: "65+", unknown: "Unknown",
};
const AGE_ORDER = ["under_18", "18_24", "25_44", "45_64", "over_65", "unknown"];

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SEVERITY_COLORS: Record<string, string> = {
  Fatal: "var(--color-severity-fatal, rgb(var(--error)))",
  Injury: "var(--color-severity-injury, rgb(var(--tertiary)))",
  "Property Damage Only": "var(--color-severity-pdo, rgb(var(--outline-variant)))",
};

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function pickValue(r: DimensionRow, measure: Measure, dim: Dimension): number {
  const isDemographic = dim === "gender" || dim === "age_bracket";
  const isAtFault = dim === "at_fault_gender" || dim === "at_fault_age_bracket";

  if (measure === "killed") {
    if (isDemographic) return r.fatal_victim_count ?? 0;
    if (isAtFault) return r.fatal_party_count ?? 0;
    if (r.total_killed != null) return r.total_killed;
  }
  if (measure === "injured") {
    if (r.total_injured != null) return r.total_injured;
  }

  if (isDemographic) return r.victim_count ?? 0;
  if (isAtFault) return r.party_count ?? 0;
  return r.crash_count ?? 0;
}

/** Capitalize an API gender slug ("male" → "Male"). */
function genderLabel(r: DimensionRow): string {
  const g = r.gender ?? "";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

function transformRows(dimension: Dimension, measure: Measure, rows: DimensionRow[]): ChartDataItem[] {
  const val = (r: DimensionRow) => pickValue(r, measure, dimension);
  // Scatter/rate inputs shared by every dimension: crash count on x, deaths on y.
  const xy = (r: DimensionRow) => ({ x: r.crash_count ?? 0, y: r.total_killed ?? 0 });

  switch (dimension) {
    case "hour":
      return rows.map((r) => ({ label: `${r.hour ?? 0}:00`, value: val(r), ...xy(r) }));
    case "day_of_week":
      return rows.map((r) => ({
        label: DOW_LABEL[r.day_of_week ?? -1] ?? String(r.day_of_week),
        value: val(r), ...xy(r),
      }));
    case "month":
      return rows.map((r) => ({
        label: MONTH_LABEL[(r.month ?? 0) - 1] ?? String(r.month),
        value: val(r), ...xy(r),
      }));
    case "year": {
      const currentYear = new Date().getFullYear();
      return rows
        .filter((r) => r.year != null && r.year < currentYear)
        .map((r) => ({ label: String(r.year), value: val(r), ...xy(r) }));
    }
    case "cause":
      return rows.map((r) => ({
        label: CAUSE_LABEL[r.canonical_cause ?? ""] ?? String(r.canonical_cause),
        value: val(r), ...xy(r),
      }));
    case "severity":
      return rows.map((r) => ({
        label: r.severity ?? "Unknown",
        value: val(r),
        color: SEVERITY_COLORS[r.severity ?? ""],
        ...xy(r),
      }));
    case "county":
      return [...rows]
        .sort((a, b) => val(b) - val(a))
        .slice(0, 30)
        .map((r) => ({ label: String(r.county_name), value: val(r), ...xy(r) }));
    case "gender":
    case "at_fault_gender":
      return rows
        .filter((r) => r.gender && r.gender !== "unknown")
        .map((r) => ({ label: genderLabel(r), value: val(r), ...xy(r) }));
    case "age_bracket":
    case "at_fault_age_bracket":
      return [...rows]
        .filter((r) => r.age_bracket !== "unknown")
        .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket ?? "") - AGE_ORDER.indexOf(b.age_bracket ?? ""))
        .map((r) => ({
          label: AGE_LABEL[r.age_bracket ?? ""] ?? String(r.age_bracket),
          value: val(r), ...xy(r),
        }));
    case "weather":
    case "lighting":
    case "collision_type":
      return rows.map((r) => ({
        label: String(r.value ?? r[dimension] ?? "Unknown"),
        value: val(r), ...xy(r),
      }));
    default:
      return [];
  }
}

export function useDashboardData(charts: ChartSlot[], filters: StatsFilters, crossFilterOverrides?: Record<string, string | undefined>) {
  const groups = useMemo(() => {
    const dims = new Set(charts.map((c) => c.dimension));
    return [...dims] as string[];
  }, [charts]);

  const filterBody = useMemo(() => {
    const b: Record<string, string> = {};
    if (filters.dateRange?.start) b.start = formatYearMonth(filters.dateRange.start);
    if (filters.dateRange?.end) b.end = formatYearMonth(filters.dateRange.end);
    if (filters.severities.length) b.severity = filters.severities.map(severityToSlug).join(",");
    if (filters.causes.length) b.cause = filters.causes.join(",");
    if (filters.counties.length) b.county = filters.counties.join(",");
    if (filters.alcohol) b.alcohol = "true";
    if (filters.pedestrian) b.pedestrian = "true";
    if (filters.cyclist) b.cyclist = "true";
    if (filters.drug) b.drug = "true";
    if (filters.distracted) b.distracted = "true";
    if (filters.driverAge) b.driver_age = filters.driverAge;
    if (filters.weather) b.weather = filters.weather;
    if (filters.lighting) b.lighting = filters.lighting;
    if (filters.collisionType) b.collision_type = filters.collisionType;
    if (filters.roadType) b.road_type = filters.roadType;
    if (filters.hitRun) b.hit_run = "true";
    // Merge cross-filter overrides (narrow, don't replace)
    if (crossFilterOverrides) {
      for (const [key, val] of Object.entries(crossFilterOverrides)) {
        if (!val) continue;
        if (b[key]) {
          // Narrow: intersect with existing (only keep the override value if it exists in current)
          const existing = b[key].split(",");
          if (existing.includes(val)) {
            b[key] = val;
          } else {
            // Override value not in current filter list — use it directly (backend will just return nothing for invalid combos)
            b[key] = val;
          }
        } else {
          b[key] = val;
        }
      }
    }
    return b;
  }, [filters, crossFilterOverrides]);

  const query = useQuery({
    queryKey: ["dashboard", groups, filterBody],
    queryFn: async (): Promise<StatsBatchResponse> => {
      if (groups.length === 0) return {};
      const res = await fetch(`${API_BASE}/api/stats/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups, ...filterBody }),
      });
      if (!res.ok) throw new Error(`dashboard batch ${res.status}`);
      return (await res.json()) as StatsBatchResponse;
    },
    enabled: groups.length > 0,
    staleTime: 60_000,
  });

  const dataBySlot = useMemo(() => {
    const raw: StatsBatchResponse = query.data ?? {};
    const result: Record<string, ChartDataItem[]> = {};

    // Shared by the primary and secondary series: raw rows → chart items with
    // the derived-measure math (percentage / fatality_rate / yoy_change)
    // applied. Chart-specific display options (cumulative, moving average,
    // log scale) are applied to the primary series only, below.
    const computeItems = (dimension: Dimension, measure: Measure): ChartDataItem[] => {
      let items = transformRows(dimension, measure, raw[dimension] ?? []);
      if (measure === "percentage") {
        const total = items.reduce((s, d) => s + d.value, 0);
        items = total > 0
          ? items.map((d) => ({ ...d, value: Math.round((d.value / total) * 1000) / 10 }))
          : items;
      } else if (measure === "fatality_rate") {
        items = items.map((d) => {
          const crashes = d.x ?? 1;
          const killed = d.y ?? 0;
          return { ...d, value: crashes > 0 ? Math.round((killed / crashes) * 10000) / 100 : 0 };
        });
      } else if (measure === "yoy_change") {
        const base = items.map(d => d.value);
        items = items.map((d, i) => {
          if (i === 0) return { ...d, value: 0 };
          const prev = base[i - 1];
          return { ...d, value: prev > 0 ? Math.round(((base[i] - prev) / prev) * 1000) / 10 : 0 };
        });
      }
      return items;
    };

    for (const chart of charts) {
      const key = slotKey(chart);
      if (!result[key]) {
        let items = computeItems(chart.dimension, chart.measure);

        const opts = chart.options ?? {};
        if (opts.cumulative) {
          let sum = 0;
          items = items.map((d) => { sum += d.value; return { ...d, value: sum }; });
        }
        if (opts.movingAvg && opts.movingAvg > 1) {
          const smoothed = movingAverage(items.map(d => d.value), opts.movingAvg);
          items = items.map((d, i) => ({ ...d, value: Math.round(smoothed[i] * 10) / 10 }));
        }
        if (opts.logScale) {
          items = items.map((d) => ({ ...d, value: d.value > 0 ? Math.round(Math.log10(d.value) * 100) / 100 : 0 }));
        }
        result[key] = items;
      }

      // Dual-axis charts read a plain `${dimension}:${secondaryMeasure}` key
      // (DashboardGrid's secondarySlotKey) that previously was never written,
      // so the secondary axis silently rendered empty (audit M15).
      if (chart.secondaryMeasure) {
        const secondaryKey = `${chart.dimension}:${chart.secondaryMeasure}`;
        if (!result[secondaryKey]) {
          result[secondaryKey] = computeItems(chart.dimension, chart.secondaryMeasure);
        }
      }
    }
    return result;
  }, [query.data, charts]);

  return {
    dataBySlot,
    loading: query.isLoading,
    error: query.error ? String(query.error) : null,
    refetch: query.refetch,
  };
}
