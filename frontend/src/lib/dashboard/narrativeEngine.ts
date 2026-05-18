/**
 * Narrative Engine
 *
 * Generates human-readable narrative summaries from dashboard chart data.
 * Designed to provide contextual explanations of trends, anomalies, and
 * statistical patterns for the CalSight crash data dashboard.
 */

import type { ChartDataItem } from "../../hooks/useDashboardData";
import type { Anomaly } from "./anomaly";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type NarrativeTone = "plain" | "technical";

export interface FilterDescription {
  counties: string[];
  severities: string[];
  causes: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
  flags: string[];
}

export interface StatFact {
  type: "peak" | "trough" | "trend" | "concentration" | "dominance" | "comparison" | "volatility" | "outlier" | "change_point";
  strength: "strong" | "moderate" | "weak";
  label: string;
  value?: number;
}

export interface ChartNarrativeResult {
  paragraph: string;
  sentences: string[];
  facts: StatFact[];
  confidence: number;
}

export interface KeyFinding {
  text: string;
  icon: string;
  sourceChart: string;
  priority: number;
}

export interface DashboardNarrative {
  keyFindings: KeyFinding[];
  filterContext: string;
  dataNote: string | null;
  chartNarratives: Map<string, ChartNarrativeResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function describeTrend(values: number[]): { direction: "up" | "down" | "flat"; magnitude: number } {
  if (values.length < 2) return { direction: "flat", magnitude: 0 };
  const first = values.slice(0, Math.ceil(values.length / 3));
  const last = values.slice(-Math.ceil(values.length / 3));
  const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
  const avgLast = last.reduce((s, v) => s + v, 0) / last.length;
  const pctChange = avgFirst === 0 ? 0 : ((avgLast - avgFirst) / avgFirst) * 100;
  if (Math.abs(pctChange) < 5) return { direction: "flat", magnitude: Math.abs(pctChange) };
  return { direction: pctChange > 0 ? "up" : "down", magnitude: Math.abs(pctChange) };
}

function findPeakAndTrough(data: ChartDataItem[]): { peak: ChartDataItem | null; trough: ChartDataItem | null } {
  if (data.length === 0) return { peak: null, trough: null };
  let peak = data[0];
  let trough = data[0];
  for (const item of data) {
    if (item.value > peak.value) peak = item;
    if (item.value < trough.value) trough = item;
  }
  return { peak, trough };
}

function buildFilterContext(filters: FilterDescription): string {
  const parts: string[] = [];
  if (filters.counties.length > 0) {
    parts.push(filters.counties.length === 1
      ? filters.counties[0]
      : `${filters.counties.length} counties`);
  } else {
    parts.push("All counties");
  }
  if (filters.severities.length > 0) {
    parts.push(filters.severities.join(", "));
  }
  if (filters.dateRange?.start || filters.dateRange?.end) {
    const range = [filters.dateRange.start, filters.dateRange.end].filter(Boolean).join(" - ");
    parts.push(range);
  }
  if (filters.flags.length > 0) {
    parts.push(filters.flags.join(", "));
  }
  return parts.join(" | ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart Narrative Generation
// ─────────────────────────────────────────────────────────────────────────────

export function generateChartNarrative(
  data: ChartDataItem[],
  dimension: string,
  measure: string,
  tone: NarrativeTone,
): ChartNarrativeResult {
  if (data.length === 0) {
    return { paragraph: "", sentences: [], facts: [], confidence: 0 };
  }

  const values = data.map(d => d.value);
  const total = values.reduce((s, v) => s + v, 0);
  const mean = total / values.length;
  const { peak, trough } = findPeakAndTrough(data);
  const trend = describeTrend(values);

  const sentences: string[] = [];
  const facts: StatFact[] = [];

  // Trend sentence
  if (trend.direction !== "flat") {
    const verb = trend.direction === "up" ? "increased" : "decreased";
    sentences.push(
      tone === "technical"
        ? `${measure} ${verb} by approximately ${trend.magnitude.toFixed(1)}% across the ${dimension} axis.`
        : `${measure} has ${verb} by about ${Math.round(trend.magnitude)}% over this period.`
    );
    facts.push({
      type: "trend",
      strength: trend.magnitude > 30 ? "strong" : trend.magnitude > 10 ? "moderate" : "weak",
      label: `${trend.direction === "up" ? "+" : "-"}${trend.magnitude.toFixed(0)}%`,
      value: trend.magnitude,
    });
  } else {
    sentences.push(
      tone === "technical"
        ? `${measure} remained relatively stable across the ${dimension} axis (< 5% variation).`
        : `${measure} stayed fairly steady over this period.`
    );
  }

  // Peak
  if (peak && values.length > 2) {
    const peakVal = peak.value;
    const peakPct = mean > 0 ? ((peakVal - mean) / mean) * 100 : 0;
    if (Math.abs(peakPct) > 15) {
      sentences.push(
        tone === "technical"
          ? `Peak of ${formatNumber(peakVal)} at ${peak.label} (${peakPct.toFixed(0)}% above mean).`
          : `The highest point was ${formatNumber(peakVal)} at ${peak.label}.`
      );
      facts.push({
        type: "peak",
        strength: peakPct > 50 ? "strong" : peakPct > 25 ? "moderate" : "weak",
        label: `Peak: ${formatNumber(peakVal)}`,
        value: peakVal,
      });
    }
  }

  // Trough
  if (trough && values.length > 2) {
    const troughVal = trough.value;
    const troughPct = mean > 0 ? ((mean - troughVal) / mean) * 100 : 0;
    if (troughPct > 30) {
      sentences.push(
        tone === "technical"
          ? `Trough of ${formatNumber(troughVal)} at ${trough.label} (${troughPct.toFixed(0)}% below mean).`
          : `The lowest point was ${formatNumber(troughVal)} at ${trough.label}.`
      );
      facts.push({
        type: "trough",
        strength: troughPct > 60 ? "strong" : troughPct > 40 ? "moderate" : "weak",
        label: `Trough: ${formatNumber(troughVal)}`,
        value: troughVal,
      });
    }
  }

  // Concentration / dominance check
  if (values.length >= 3) {
    const sorted = [...values].sort((a, b) => b - a);
    const topShare = total > 0 ? sorted[0] / total : 0;
    if (topShare > 0.4) {
      const topItem = data.find(d => d.value === sorted[0]);
      facts.push({
        type: "dominance",
        strength: topShare > 0.6 ? "strong" : "moderate",
        label: `${(topShare * 100).toFixed(0)}% share`,
        value: topShare,
      });
      if (topItem) {
        sentences.push(
          tone === "technical"
            ? `${topItem.label} accounts for ${(topShare * 100).toFixed(1)}% of total ${measure}.`
            : `${topItem.label} makes up ${Math.round(topShare * 100)}% of the total.`
        );
      }
    }
  }

  const paragraph = sentences.join(" ");
  const confidence = Math.min(1, 0.3 + (data.length / 20) + (facts.length * 0.1));

  return { paragraph, sentences, facts, confidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Narrative Generation
// ─────────────────────────────────────────────────────────────────────────────

export function generateDashboardNarrative(
  dataBySlot: Record<string, ChartDataItem[]>,
  chartMeta: { id: string; dimension: string; measure: string; dimensionLabel?: string; measureLabel?: string }[],
  anomalies: Anomaly[],
  filters: FilterDescription,
  tone: NarrativeTone,
): DashboardNarrative {
  const chartNarratives = new Map<string, ChartNarrativeResult>();
  const keyFindings: KeyFinding[] = [];

  // Generate narratives for each chart
  for (const meta of chartMeta) {
    const key = `${meta.dimension}:${meta.measure}`;
    const data = dataBySlot[key];
    if (!data || data.length === 0) continue;

    const narrative = generateChartNarrative(data, meta.dimensionLabel ?? meta.dimension, meta.measureLabel ?? meta.measure, tone);
    chartNarratives.set(meta.id, narrative);

    // Extract key findings from high-confidence charts
    if (narrative.confidence >= 0.5 && narrative.sentences.length > 0) {
      const icon = narrative.facts.some(f => f.type === "trend" && f.strength === "strong")
        ? "trending_up"
        : narrative.facts.some(f => f.type === "peak" && f.strength === "strong")
          ? "warning"
          : "insights";

      keyFindings.push({
        text: narrative.sentences[0],
        icon,
        sourceChart: meta.id,
        priority: narrative.confidence * (narrative.facts.length + 1),
      });
    }
  }

  // Add anomaly-based findings
  const severityWeight: Record<string, number> = { critical: 3, high: 2, medium: 1 };
  for (const anomaly of anomalies.slice(0, 3)) {
    keyFindings.push({
      text: tone === "technical"
        ? `Anomaly detected: ${anomaly.label} deviates significantly from expected pattern (${anomaly.method}, confidence ${(anomaly.confidence * 100).toFixed(0)}%).`
        : `Unusual pattern found in ${anomaly.label}.`,
      icon: "warning",
      sourceChart: `${anomaly.dimension}:${anomaly.measure}`,
      priority: (severityWeight[anomaly.severity] ?? 1) * 2,
    });
  }

  // Deduplicate by text content and sort by priority
  const seen = new Set<string>();
  const deduped = keyFindings.filter(f => {
    if (seen.has(f.text)) return false;
    seen.add(f.text);
    return true;
  });
  keyFindings.length = 0;
  keyFindings.push(...deduped);
  keyFindings.sort((a, b) => b.priority - a.priority);

  const filterContext = buildFilterContext(filters);

  // Data quality note
  const totalDataPoints = Object.values(dataBySlot).reduce((s, arr) => s + arr.length, 0);
  const dataNote = totalDataPoints < 10
    ? "Limited data available. Insights may not be statistically meaningful."
    : null;

  return {
    keyFindings,
    filterContext,
    dataNote,
    chartNarratives,
  };
}
