import { useMemo } from "react";
import type { ChartSlot } from "../lib/dashboard/types";
import type { ChartDataItem } from "./useDashboardData";
import type { Anomaly } from "../lib/dashboard/anomaly";
import type { StatsFilters } from "./useStats";
import { generateSuggestions, type ChartSuggestion } from "../lib/dashboard/chartSuggestion";

export type { ChartSuggestion };

interface UseChartSuggestionsOptions {
  activeCharts: ChartSlot[];
  dataBySlot: Record<string, ChartDataItem[]>;
  filters: StatsFilters;
  anomalies: Anomaly[];
  enabled?: boolean;
}

/**
 * Hook that returns smart chart suggestions based on current dashboard state.
 * Suggestions are memoized and only recomputed when inputs change.
 */
export function useChartSuggestions({
  activeCharts,
  dataBySlot,
  filters,
  anomalies,
  enabled = true,
}: UseChartSuggestionsOptions): ChartSuggestion[] {
  return useMemo(() => {
    if (!enabled || activeCharts.length === 0) return [];
    return generateSuggestions(activeCharts, dataBySlot, filters, anomalies);
  }, [activeCharts, dataBySlot, filters, anomalies, enabled]);
}
