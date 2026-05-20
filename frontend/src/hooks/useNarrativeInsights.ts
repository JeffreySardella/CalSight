import { useMemo, useState, useCallback } from "react";
import type { ChartDataItem } from "./useDashboardData";
import { slotKey, DIMENSION_LABELS, MEASURE_LABELS, type ChartSlot, type Dimension, type Measure } from "../lib/dashboard/types";
import type { Anomaly } from "../lib/dashboard/anomaly";
import type { StatsFilters } from "./useStats";
import {
  generateDashboardNarrative,
  generateChartNarrative,
  type DashboardNarrative,
  type ChartNarrativeResult,
  type NarrativeTone,
  type FilterDescription,
} from "../lib/dashboard/narrativeEngine";

export type { DashboardNarrative, ChartNarrativeResult, NarrativeTone };

interface UseNarrativeInsightsOptions {
  dataBySlot: Record<string, ChartDataItem[]>;
  charts: ChartSlot[];
  anomalies: Anomaly[];
  filters: StatsFilters;
  enabled?: boolean;
}

interface UseNarrativeInsightsResult {
  /** Full dashboard narrative with key findings */
  narrative: DashboardNarrative | null;
  /** Get the narrative for a specific chart by slot ID */
  getChartNarrative: (slotId: string) => ChartNarrativeResult | null;
  /** Current tone setting */
  tone: NarrativeTone;
  /** Toggle between technical and plain language */
  setTone: (tone: NarrativeTone) => void;
  /** Whether narrative generation is active */
  enabled: boolean;
}

function filtersToDescription(filters: StatsFilters): FilterDescription {
  const flags: string[] = [];
  if (filters.alcohol) flags.push("alcohol");
  if (filters.pedestrian) flags.push("pedestrians");
  if (filters.cyclist) flags.push("cyclists");
  if (filters.drug) flags.push("drugs");
  if (filters.distracted) flags.push("distracted driving");

  return {
    counties: filters.counties,
    severities: filters.severities,
    causes: filters.causes,
    dateRange: filters.dateRange
      ? {
        start: filters.dateRange.start
          ? `${filters.dateRange.start.year}-${String(filters.dateRange.start.month).padStart(2, "0")}`
          : undefined,
        end: filters.dateRange.end
          ? `${filters.dateRange.end.year}-${String(filters.dateRange.end.month).padStart(2, "0")}`
          : undefined,
      }
      : undefined,
    flags,
  };
}

/**
 * Hook that provides auto-generated narrative insights for the dashboard.
 * Narratives automatically update when filters, data, or charts change.
 *
 * Usage:
 * ```tsx
 * const { narrative, getChartNarrative, tone, setTone } = useNarrativeInsights({
 *   dataBySlot, charts, anomalies, filters
 * });
 * ```
 */
export function useNarrativeInsights({
  dataBySlot,
  charts,
  anomalies,
  filters,
  enabled = true,
}: UseNarrativeInsightsOptions): UseNarrativeInsightsResult {
  const [tone, setTone] = useState<NarrativeTone>("plain");

  const filterDesc = useMemo(() => filtersToDescription(filters), [filters]);

  const chartMeta = useMemo(
    () => charts.map(c => ({
      id: c.id,
      dimension: c.dimension,
      measure: c.measure,
      options: c.options,
      dimensionLabel: DIMENSION_LABELS[c.dimension as Dimension] ?? c.dimension,
      measureLabel: MEASURE_LABELS[c.measure as Measure] ?? c.measure,
    })),
    [charts],
  );

  const narrative = useMemo<DashboardNarrative | null>(() => {
    if (!enabled) return null;
    const keys = Object.keys(dataBySlot);
    if (keys.length === 0) return null;
    return generateDashboardNarrative(dataBySlot, chartMeta, anomalies, filterDesc, tone);
  }, [dataBySlot, chartMeta, anomalies, filterDesc, tone, enabled]);

  const getChartNarrative = useCallback(
    (slotId: string): ChartNarrativeResult | null => {
      if (!enabled || !narrative) return null;
      // Try direct ID lookup
      const byId = narrative.chartNarratives.get(slotId);
      if (byId) return byId;

      // Fallback: find the chart and generate on demand
      const chart = charts.find(c => c.id === slotId);
      if (!chart) return null;
      const key = slotKey(chart);
      const data = dataBySlot[key];
      if (!data || data.length === 0) return null;
      return generateChartNarrative(
        data,
        DIMENSION_LABELS[chart.dimension as Dimension] ?? chart.dimension,
        MEASURE_LABELS[chart.measure as Measure] ?? chart.measure,
        tone,
      );
    },
    [enabled, narrative, charts, dataBySlot, tone],
  );

  return {
    narrative,
    getChartNarrative,
    tone,
    setTone,
    enabled,
  };
}
