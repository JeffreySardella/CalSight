import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import type { ChartSlot, Dimension, Measure } from "../lib/dashboard/types";
import type { StatsFilters } from "./useStats";
import { formatYearMonth } from "./useFilterParams";

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
  Fatal: "rgb(var(--error))",
  Injury: "rgb(var(--tertiary))",
  "Property Damage Only": "rgb(var(--outline-variant))",
};

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function pickValue(r: Record<string, unknown>, measure: Measure, dim: Dimension): number {
  const isDemographic = dim === "gender" || dim === "age_bracket";
  const isAtFault = dim === "at_fault_gender" || dim === "at_fault_age_bracket";

  if (measure === "killed") {
    if (isDemographic) return (r.fatal_victim_count as number) ?? 0;
    if (isAtFault) return (r.fatal_party_count as number) ?? 0;
    if (r.total_killed != null) return r.total_killed as number;
  }
  if (measure === "injured") {
    if (r.total_injured != null) return r.total_injured as number;
  }

  if (isDemographic) return (r.victim_count as number) ?? 0;
  if (isAtFault) return (r.party_count as number) ?? 0;
  return (r.crash_count as number) ?? 0;
}

function transformRows(dimension: Dimension, measure: Measure, rows: Record<string, unknown>[]): ChartDataItem[] {
  const val = (r: Record<string, unknown>) => pickValue(r, measure, dimension);

  switch (dimension) {
    case "hour":
      return rows.map((r) => ({ label: `${r.hour as number}:00`, value: val(r) }));
    case "day_of_week":
      return rows.map((r) => ({
        label: DOW_LABEL[(r.day_of_week as number)] ?? String(r.day_of_week),
        value: val(r),
      }));
    case "month":
      return rows.map((r) => ({
        label: MONTH_LABEL[(r.month as number) - 1] ?? String(r.month),
        value: val(r),
      }));
    case "year": {
      const currentYear = new Date().getFullYear();
      return rows
        .filter((r) => (r.year as number) < currentYear)
        .map((r) => ({
          label: String(r.year), value: val(r),
          x: (r.crash_count as number) ?? 0,
          y: (r.total_killed as number) ?? 0,
        }));
    }
    case "cause":
      return rows.map((r) => ({
        label: CAUSE_LABEL[r.canonical_cause as string] ?? String(r.canonical_cause),
        value: val(r),
        x: (r.crash_count as number) ?? 0,
        y: (r.total_killed as number) ?? 0,
      }));
    case "severity":
      return rows.map((r) => ({
        label: r.severity as string,
        value: val(r),
        color: SEVERITY_COLORS[r.severity as string],
        x: (r.crash_count as number) ?? 0,
        y: (r.total_killed as number) ?? 0,
      }));
    case "county":
      return rows
        .sort((a, b) => val(b) - val(a))
        .slice(0, 30)
        .map((r) => ({
          label: String(r.county_name), value: val(r),
          x: (r.crash_count as number) ?? 0,
          y: (r.total_killed as number) ?? 0,
        }));
    case "gender":
      return rows
        .filter((r) => r.gender && r.gender !== "unknown")
        .map((r) => ({
          label: (r.gender as string).charAt(0).toUpperCase() + (r.gender as string).slice(1),
          value: val(r),
        }));
    case "age_bracket":
      return rows
        .filter((r) => r.age_bracket !== "unknown")
        .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket as string) - AGE_ORDER.indexOf(b.age_bracket as string))
        .map((r) => ({
          label: AGE_LABEL[r.age_bracket as string] ?? String(r.age_bracket),
          value: val(r),
        }));
    case "at_fault_gender":
      return rows
        .filter((r) => r.gender && r.gender !== "unknown")
        .map((r) => ({
          label: (r.gender as string).charAt(0).toUpperCase() + (r.gender as string).slice(1),
          value: val(r),
        }));
    case "at_fault_age_bracket":
      return rows
        .filter((r) => r.age_bracket !== "unknown")
        .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket as string) - AGE_ORDER.indexOf(b.age_bracket as string))
        .map((r) => ({
          label: AGE_LABEL[r.age_bracket as string] ?? String(r.age_bracket),
          value: val(r),
        }));
    case "weather":
    case "lighting":
    case "collision_type":
      return rows.map((r) => ({
        label: String(r.value ?? r[dimension] ?? "Unknown"),
        value: val(r),
      }));
    default:
      return [];
  }
}

export function useDashboardData(charts: ChartSlot[], filters: StatsFilters) {
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
    return b;
  }, [filters]);

  const query = useQuery({
    queryKey: ["dashboard", groups, filterBody],
    queryFn: async () => {
      if (groups.length === 0) return {} as Record<string, Record<string, unknown>[]>;
      const res = await fetch(`${API_BASE}/api/stats/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups, ...filterBody }),
      });
      if (!res.ok) throw new Error(`dashboard batch ${res.status}`);
      return await res.json() as Record<string, Record<string, unknown>[]>;
    },
    enabled: groups.length > 0,
  });

  const dataBySlot = useMemo(() => {
    const raw = query.data ?? {};
    const result: Record<string, ChartDataItem[]> = {};
    for (const chart of charts) {
      const key = `${chart.dimension}:${chart.measure}`;
      if (!result[key]) {
        let items = transformRows(chart.dimension, chart.measure, raw[chart.dimension] ?? []);
        if (chart.measure === "percentage") {
          const total = items.reduce((s, d) => s + d.value, 0);
          items = total > 0
            ? items.map((d) => ({ ...d, value: Math.round((d.value / total) * 1000) / 10 }))
            : items;
        } else if (chart.measure === "fatality_rate") {
          const rawRows = raw[chart.dimension] ?? [];
          items = items.map((d, i) => {
            const r = rawRows[i];
            const crashes = r ? ((r.crash_count as number) ?? 1) : 1;
            const killed = r ? ((r.total_killed as number) ?? 0) : 0;
            return { ...d, value: crashes > 0 ? Math.round((killed / crashes) * 10000) / 100 : 0 };
          });
        } else if (chart.measure === "yoy_change") {
          items = items.map((d, i) => {
            if (i === 0) return { ...d, value: 0 };
            const prev = items[i - 1].value;
            return { ...d, value: prev > 0 ? Math.round(((d.value - prev) / prev) * 1000) / 10 : 0 };
          });
        }
        result[key] = items;
      }
    }
    return result;
  }, [query.data, charts]);

  return {
    dataBySlot,
    loading: query.isLoading,
    error: query.error ? String(query.error) : null,
  };
}
