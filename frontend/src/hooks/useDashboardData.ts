import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import type { ChartSlot, Dimension } from "../lib/dashboard/types";
import type { StatsFilters } from "./useStats";
import { formatYearMonth } from "./useFilterParams";

export type ChartDataItem = { label: string; value: number; color?: string };

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
  Fatal: "#dc2626", Injury: "#f59e0b", "Property Damage Only": "#6b7280",
};

function severityToSlug(s: string): string {
  return s.toLowerCase().replace(/ /g, "-");
}

function transformRows(dimension: Dimension, rows: Record<string, unknown>[]): ChartDataItem[] {
  switch (dimension) {
    case "hour":
      return rows.map((r) => ({
        label: `${r.hour as number}:00`,
        value: (r.crash_count as number) ?? 0,
      }));
    case "day_of_week":
      return rows.map((r) => ({
        label: DOW_LABEL[(r.day_of_week as number)] ?? String(r.day_of_week),
        value: (r.crash_count as number) ?? 0,
      }));
    case "month":
      return rows.map((r) => ({
        label: MONTH_LABEL[(r.month as number) - 1] ?? String(r.month),
        value: (r.crash_count as number) ?? 0,
      }));
    case "year":
      return rows.map((r) => ({
        label: String(r.year),
        value: (r.crash_count as number) ?? 0,
      }));
    case "cause":
      return rows.map((r) => ({
        label: CAUSE_LABEL[r.canonical_cause as string] ?? String(r.canonical_cause),
        value: (r.crash_count as number) ?? 0,
      }));
    case "severity":
      return rows.map((r) => ({
        label: r.severity as string,
        value: (r.crash_count as number) ?? 0,
        color: SEVERITY_COLORS[r.severity as string],
      }));
    case "gender":
      return rows
        .filter((r) => r.gender && r.gender !== "unknown")
        .map((r) => ({
          label: (r.gender as string).charAt(0).toUpperCase() + (r.gender as string).slice(1),
          value: (r.victim_count as number) ?? 0,
        }));
    case "age_bracket":
      return rows
        .filter((r) => r.age_bracket !== "unknown")
        .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket as string) - AGE_ORDER.indexOf(b.age_bracket as string))
        .map((r) => ({
          label: AGE_LABEL[r.age_bracket as string] ?? String(r.age_bracket),
          value: (r.victim_count as number) ?? 0,
        }));
    case "at_fault_gender":
      return rows
        .filter((r) => r.gender && r.gender !== "unknown")
        .map((r) => ({
          label: (r.gender as string).charAt(0).toUpperCase() + (r.gender as string).slice(1),
          value: (r.party_count as number) ?? 0,
        }));
    case "at_fault_age_bracket":
      return rows
        .filter((r) => r.age_bracket !== "unknown")
        .sort((a, b) => AGE_ORDER.indexOf(a.age_bracket as string) - AGE_ORDER.indexOf(b.age_bracket as string))
        .map((r) => ({
          label: AGE_LABEL[r.age_bracket as string] ?? String(r.age_bracket),
          value: (r.party_count as number) ?? 0,
        }));
    case "weather":
    case "lighting":
    case "collision_type":
      return rows.map((r) => ({
        label: String(r[dimension] ?? "Unknown"),
        value: (r.crash_count as number) ?? 0,
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
      if (groups.length === 0) return {} as Record<string, ChartDataItem[]>;
      const res = await fetch(`${API_BASE}/api/stats/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups, ...filterBody }),
      });
      if (!res.ok) throw new Error(`dashboard batch ${res.status}`);
      const raw: Record<string, Record<string, unknown>[]> = await res.json();
      const result: Record<string, ChartDataItem[]> = {};
      for (const dim of groups) {
        result[dim] = transformRows(dim as Dimension, raw[dim] ?? []);
      }
      return result;
    },
    enabled: groups.length > 0,
  });

  return {
    dataByDimension: query.data ?? ({} as Record<string, ChartDataItem[]>),
    loading: query.isLoading,
    error: query.error ? String(query.error) : null,
  };
}
