/**
 * useSmartLabels - React hook for chart label placement.
 *
 * Provides a simple API for chart components to compute label positions,
 * handle responsive density, and maintain accessibility for hidden labels.
 */

import { useMemo } from "react";
import {
  computeBarLabels,
  computeDonutLabels,
  computeLineLabels,
  computeScatterLabels,
  computeTreemapLabels,
  computeLollipopLabels,
  generateChartAriaLabel,
  type BarLabelResult,
  type DonutLabelResult,
  type LinePointLabel,
  type ScatterLabelResult,
  type TreemapLabelResult,
  type LollipopLabelResult,
  type PlacementConfig,
} from "../../lib/dashboard/labelPlacement";

// Re-export types for convenience
export type {
  BarLabelResult,
  DonutLabelResult,
  LinePointLabel,
  ScatterLabelResult,
  TreemapLabelResult,
  LollipopLabelResult,
};

// ---------------------------------------------------------------------------
// Bar Chart
// ---------------------------------------------------------------------------

export function useBarLabels(
  labels: string[],
  chartWidth: number,
  barSlotWidth: number,
  config?: PlacementConfig,
): BarLabelResult[] {
  return useMemo(
    () => computeBarLabels(labels, chartWidth, barSlotWidth, config),
    [labels, chartWidth, barSlotWidth, config],
  );
}

// ---------------------------------------------------------------------------
// Donut Chart
// ---------------------------------------------------------------------------

export function useDonutLabels(
  segments: Array<{ label: string; value: number; midAngle: number }>,
  cx: number,
  cy: number,
  outerRadius: number,
  total: number,
  chartWidth: number,
): DonutLabelResult[] {
  return useMemo(
    () => computeDonutLabels(segments, cx, cy, outerRadius, total, chartWidth),
    [segments, cx, cy, outerRadius, total, chartWidth],
  );
}

// ---------------------------------------------------------------------------
// Line Chart
// ---------------------------------------------------------------------------

export function useLineLabels(
  values: number[],
  points: Array<{ x: number; y: number }>,
  chartWidth: number,
  formatValue: (v: number) => string,
  config?: PlacementConfig,
): LinePointLabel[] {
  return useMemo(
    () => computeLineLabels(values, points, chartWidth, formatValue, config),
    [values, points, chartWidth, formatValue, config],
  );
}

// ---------------------------------------------------------------------------
// Scatter Chart
// ---------------------------------------------------------------------------

export function useScatterLabels(
  data: Array<{ label: string; px: number; py: number; radius: number }>,
  bounds: { x: number; y: number; width: number; height: number },
  chartWidth: number,
  config?: PlacementConfig,
): ScatterLabelResult[] {
  return useMemo(
    () => computeScatterLabels(data, bounds, chartWidth, config),
    [data, bounds, chartWidth, config],
  );
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

export function useTreemapLabels(
  cells: Array<{ x: number; y: number; w: number; h: number; label: string; pct: number }>,
  chartWidth: number,
  config?: PlacementConfig,
): TreemapLabelResult[] {
  return useMemo(
    () => computeTreemapLabels(cells, chartWidth, config),
    [cells, chartWidth, config],
  );
}

// ---------------------------------------------------------------------------
// Lollipop
// ---------------------------------------------------------------------------

export function useLollipopLabels(
  data: Array<{ label: string; value: number; barEndX: number; y: number }>,
  labelWidth: number,
  chartWidth: number,
  formatValue: (v: number) => string,
  config?: PlacementConfig,
): LollipopLabelResult[] {
  return useMemo(
    () => computeLollipopLabels(data, labelWidth, chartWidth, formatValue, config),
    [data, labelWidth, chartWidth, formatValue, config],
  );
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export function useChartAriaLabel(
  chartType: string,
  title: string,
  dataPoints: Array<{ label: string; value: number | string }>,
): string {
  return useMemo(
    () => generateChartAriaLabel(chartType, title, dataPoints),
    [chartType, title, dataPoints],
  );
}
