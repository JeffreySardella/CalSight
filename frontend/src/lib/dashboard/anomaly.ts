import { mean, stddev } from "./stats";
import { slotKey, type Dimension, type Measure, type ChartOptions } from "./types";
import type { ChartDataItem } from "../../hooks/useDashboardData";

export type AnomalySeverity = "critical" | "high" | "medium";

export interface Anomaly {
  id: string;
  method: "zscore" | "iqr" | "change_point";
  severity: AnomalySeverity;
  confidence: number;
  message: string;
  dimension: Dimension;
  measure: Measure;
  index: number;
  label: string;
  value: number;
}

const MEASURE_NOUNS: Record<string, string> = {
  count: "crashes", killed: "fatalities", injured: "injuries",
  percentage: "%", fatality_rate: "fatality rate", yoy_change: "YoY change",
};

function measureNoun(m: Measure): string {
  return MEASURE_NOUNS[m] ?? m;
}

function fmtVal(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function zToConfidence(absZ: number): number {
  if (absZ >= 3) return 99;
  if (absZ >= 2.5) return 97;
  if (absZ >= 2) return 95;
  return 70 + (absZ - 1) * 17;
}

function scoreSeverity(confidence: number): AnomalySeverity {
  if (confidence >= 95) return "critical";
  if (confidence >= 85) return "high";
  return "medium";
}

function detectZScore(
  data: ChartDataItem[], dimension: Dimension, measure: Measure, threshold = 2,
): Anomaly[] {
  const values = data.map(d => d.value);
  if (values.length < 4) return [];
  const m = mean(values);
  const sd = stddev(values);
  if (sd === 0) return [];

  const anomalies: Anomaly[] = [];
  for (let i = 0; i < values.length; i++) {
    const z = (values[i] - m) / sd;
    const absZ = Math.abs(z);
    if (absZ < threshold) continue;
    const direction = z > 0 ? "above" : "below";
    const pctDiff = Math.round(((values[i] - m) / m) * 100);
    const confidence = zToConfidence(absZ);
    const noun = measureNoun(measure);
    anomalies.push({
      id: `z-${dimension}-${measure}-${i}`,
      method: "zscore",
      severity: scoreSeverity(confidence),
      confidence,
      message: `${data[i].label}: ${fmtVal(values[i])} ${noun} (${pctDiff > 0 ? "+" : ""}${pctDiff}% ${direction} avg, ${absZ.toFixed(1)}σ)`,
      dimension, measure,
      index: i,
      label: data[i].label,
      value: values[i],
    });
  }
  return anomalies;
}

function quartiles(values: number[]): { q1: number; q3: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    return sorted[lo] + (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]) * (idx - lo);
  };
  return { q1: pct(0.25), q3: pct(0.75) };
}

function detectIQR(
  data: ChartDataItem[], dimension: Dimension, measure: Measure, k = 1.5,
): Anomaly[] {
  const values = data.map(d => d.value);
  if (values.length < 5) return [];
  const { q1, q3 } = quartiles(values);
  const iqr = q3 - q1;
  if (iqr === 0) return [];
  const lower = q1 - k * iqr;
  const upper = q3 + k * iqr;

  const anomalies: Anomaly[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= lower && values[i] <= upper) continue;
    const direction = values[i] > upper ? "above upper" : "below lower";
    const exceedance = values[i] > upper ? (values[i] - upper) / iqr : (lower - values[i]) / iqr;
    const confidence = Math.min(99, 70 + exceedance * 15);
    anomalies.push({
      id: `iqr-${dimension}-${measure}-${i}`,
      method: "iqr",
      severity: scoreSeverity(confidence),
      confidence,
      message: `${data[i].label}: ${fmtVal(values[i])} is an outlier (${direction} IQR fence)`,
      dimension, measure,
      index: i,
      label: data[i].label,
      value: values[i],
    });
  }
  return anomalies;
}

function detectChangePoints(
  data: ChartDataItem[], dimension: Dimension, measure: Measure,
): Anomaly[] {
  const values = data.map(d => d.value);
  if (values.length < 6) return [];
  const m = mean(values);
  const sd = stddev(values);
  if (sd === 0) return [];

  const normalized = values.map(v => (v - m) / sd);
  let sHigh = 0, sLow = 0;
  const anomalies: Anomaly[] = [];

  for (let i = 0; i < normalized.length; i++) {
    sHigh = Math.max(0, sHigh + normalized[i] - 0.8);
    sLow = Math.max(0, sLow - normalized[i] - 0.8);
    if (sHigh > 4 || sLow > 4) {
      const before = values.slice(Math.max(0, i - 3), i);
      const after = values.slice(i, Math.min(values.length, i + 3));
      if (before.length < 2 || after.length < 2) continue;
      const meanBefore = mean(before);
      const meanAfter = mean(after);
      const pctChange = meanBefore > 0 ? Math.round(((meanAfter - meanBefore) / meanBefore) * 100) : 0;
      const noun = measureNoun(measure);
      anomalies.push({
        id: `cp-${dimension}-${measure}-${i}`,
        method: "change_point",
        severity: "high",
        confidence: 88,
        message: `Structural shift at ${data[i].label}: ${noun} ${pctChange > 0 ? "increased" : "decreased"} ${Math.abs(pctChange)}%`,
        dimension, measure,
        index: i,
        label: data[i].label,
        value: values[i],
      });
      sHigh = 0;
      sLow = 0;
    }
  }
  return anomalies;
}

export function detectAnomalies(
  data: ChartDataItem[], dimension: Dimension, measure: Measure,
): Anomaly[] {
  const all = [
    ...detectZScore(data, dimension, measure),
    ...detectIQR(data, dimension, measure),
    ...detectChangePoints(data, dimension, measure),
  ];
  const byIndex = new Map<number, Anomaly>();
  for (const a of all) {
    const existing = byIndex.get(a.index);
    if (!existing || a.confidence > existing.confidence) {
      byIndex.set(a.index, a);
    }
  }
  return [...byIndex.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

export function detectAllAnomalies(
  dataBySlot: Record<string, ChartDataItem[]>,
  charts: { dimension: Dimension; measure: Measure; id: string; options?: ChartOptions }[],
): { byChart: Record<string, Anomaly[]>; all: Anomaly[] } {
  const byChart: Record<string, Anomaly[]> = {};
  const all: Anomaly[] = [];
  for (const chart of charts) {
    const key = slotKey(chart);
    const data = dataBySlot[key];
    if (!data || data.length < 3) continue;
    const result = detectAnomalies(data, chart.dimension, chart.measure);
    byChart[chart.id] = result;
    all.push(...result);
  }
  all.sort((a, b) => b.confidence - a.confidence);
  return { byChart, all };
}
