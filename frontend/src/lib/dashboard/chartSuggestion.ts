import type { ChartSlot, ChartType, Dimension, Measure } from "./types";
import { DIMENSION_LABELS, MEASURE_LABELS, defaultChartType } from "./types";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import type { Anomaly } from "./anomaly";
import type { StatsFilters } from "../../hooks/useStats";

export interface ChartSuggestion {
  id: string;
  dimension: Dimension;
  measure: Measure;
  chartType: ChartType;
  title: string;
  explanation: string;
  relevance: number; // 0-100
  icon: string; // material symbol name
}

/**
 * Scoring weights for suggestion ranking.
 * Higher relevance = more useful given current dashboard context.
 */
const RELEVANCE_BOOST = {
  anomalyRelated: 25,
  filterRelated: 20,
  complementary: 15,
  unexploredDimension: 10,
  unexploredMeasure: 8,
  base: 50,
} as const;

const CHART_TYPE_ICONS: Record<ChartType, string> = {
  bar: "bar_chart",
  hbar: "bar_chart",
  line: "show_chart",
  area: "show_chart",
  donut: "donut_large",
  treemap: "donut_large",
  gauge: "speed",
  stat: "insights",
  polar: "donut_large",
  lollipop: "bar_chart",
  radar: "donut_large",
  scatter: "show_chart",
};

/**
 * Generate smart chart suggestions based on:
 * - What charts are already active (avoid duplicates)
 * - Which anomalies were detected (suggest deeper dives)
 * - Current filters (suggest relevant dimensions)
 * - Data availability per slot
 */
export function generateSuggestions(
  activeCharts: ChartSlot[],
  _dataBySlot: Record<string, ChartDataItem[]>,
  filters: StatsFilters,
  anomalies: Anomaly[],
): ChartSuggestion[] {
  const activePairs = new Set(
    activeCharts.map((c) => `${c.dimension}:${c.measure}`),
  );
  const activeDimensions = new Set(activeCharts.map((c) => c.dimension));

  const candidates: ChartSuggestion[] = [];

  // 1. Suggest charts related to detected anomalies
  for (const anomaly of anomalies.slice(0, 5)) {
    // Suggest alternative measure for same dimension
    const altMeasures: Measure[] = anomaly.measure === "count"
      ? ["killed", "fatality_rate"]
      : anomaly.measure === "killed"
        ? ["count", "injured"]
        : ["count", "killed"];

    for (const m of altMeasures) {
      const key = `${anomaly.dimension}:${m}`;
      if (activePairs.has(key)) continue;
      const chartType = defaultChartType(anomaly.dimension);
      candidates.push({
        id: `anomaly-${anomaly.dimension}-${m}`,
        dimension: anomaly.dimension,
        measure: m,
        chartType,
        title: `${MEASURE_LABELS[m]} by ${DIMENSION_LABELS[anomaly.dimension]}`,
        explanation: `Anomaly in ${DIMENSION_LABELS[anomaly.dimension]} — explore with ${MEASURE_LABELS[m].toLowerCase()}`,
        relevance: RELEVANCE_BOOST.base + RELEVANCE_BOOST.anomalyRelated,
        icon: CHART_TYPE_ICONS[chartType],
      });
    }
  }

  // 2. Suggest charts relevant to active filters
  if (filters.alcohol) {
    addIfMissing(candidates, activePairs, "hour", "count", "bar",
      "DUI crashes peak late at night — see hourly distribution");
    addIfMissing(candidates, activePairs, "day_of_week", "count", "radar",
      "Alcohol crashes cluster on weekends");
  }
  if (filters.counties.length === 1) {
    addIfMissing(candidates, activePairs, "year", "count", "area",
      "See how this county's crash count has trended over time");
    addIfMissing(candidates, activePairs, "cause", "killed", "hbar",
      "Which causes are deadliest in this county?");
  }
  if (filters.severities.length > 0 && filters.severities.includes("fatal")) {
    addIfMissing(candidates, activePairs, "age_bracket", "killed", "lollipop",
      "Which age groups face the highest fatality risk?");
  }

  // 3. Suggest unexplored dimensions
  const allDimensions: Dimension[] = [
    "hour", "day_of_week", "month", "year", "cause", "severity",
    "county", "age_bracket", "weather", "lighting", "collision_type",
  ];
  for (const dim of allDimensions) {
    if (activeDimensions.has(dim)) continue;
    const measure: Measure = "count";
    const key = `${dim}:${measure}`;
    if (activePairs.has(key)) continue;
    if (candidates.some((c) => c.id === `explore-${dim}-${measure}`)) continue;
    const chartType = defaultChartType(dim);
    let relevance = RELEVANCE_BOOST.base + RELEVANCE_BOOST.unexploredDimension;
    // Boost environmental dimensions if they're totally absent
    if ((dim === "weather" || dim === "lighting") && !activeDimensions.has("weather") && !activeDimensions.has("lighting")) {
      relevance += 5;
    }
    candidates.push({
      id: `explore-${dim}-${measure}`,
      dimension: dim,
      measure,
      chartType,
      title: `${MEASURE_LABELS[measure]} by ${DIMENSION_LABELS[dim]}`,
      explanation: `Add ${DIMENSION_LABELS[dim].toLowerCase()} to see a new angle`,
      relevance,
      icon: CHART_TYPE_ICONS[chartType],
    });
  }

  // 4. Suggest complementary measures for active dimensions
  const measureAlternatives: Record<string, Measure[]> = {
    count: ["killed", "injured", "fatality_rate"],
    killed: ["count", "fatality_rate"],
    injured: ["count", "killed"],
    fatality_rate: ["killed", "count"],
  };
  for (const chart of activeCharts.slice(0, 4)) {
    const alts = measureAlternatives[chart.measure] ?? [];
    for (const m of alts.slice(0, 1)) {
      const key = `${chart.dimension}:${m}`;
      if (activePairs.has(key)) continue;
      if (candidates.some((c) => c.id === `complement-${chart.dimension}-${m}`)) continue;
      const chartType = defaultChartType(chart.dimension);
      candidates.push({
        id: `complement-${chart.dimension}-${m}`,
        dimension: chart.dimension,
        measure: m,
        chartType,
        title: `${MEASURE_LABELS[m]} by ${DIMENSION_LABELS[chart.dimension]}`,
        explanation: `You're viewing ${MEASURE_LABELS[chart.measure].toLowerCase()} — compare with ${MEASURE_LABELS[m].toLowerCase()}`,
        relevance: RELEVANCE_BOOST.base + RELEVANCE_BOOST.complementary,
        icon: CHART_TYPE_ICONS[chartType],
      });
    }
  }

  // Deduplicate by id and sort by relevance
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  return unique.sort((a, b) => b.relevance - a.relevance).slice(0, 6);
}

function addIfMissing(
  candidates: ChartSuggestion[],
  activePairs: Set<string>,
  dimension: Dimension,
  measure: Measure,
  chartType: ChartType,
  explanation: string,
) {
  const key = `${dimension}:${measure}`;
  if (activePairs.has(key)) return;
  if (candidates.some((c) => c.id === `filter-${dimension}-${measure}`)) return;
  candidates.push({
    id: `filter-${dimension}-${measure}`,
    dimension,
    measure,
    chartType,
    title: `${MEASURE_LABELS[measure]} by ${DIMENSION_LABELS[dimension]}`,
    explanation,
    relevance: RELEVANCE_BOOST.base + RELEVANCE_BOOST.filterRelated,
    icon: CHART_TYPE_ICONS[chartType],
  });
}
