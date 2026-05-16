/**
 * Auto-Generated Insight Narrative Engine
 *
 * Template-based narrative generation that produces written paragraphs
 * describing what the data shows. No LLM required — uses statistical
 * templates with contextual awareness.
 *
 * Architecture:
 * 1. Analyzers extract statistical facts from chart data
 * 2. Templates convert facts into natural language sentences
 * 3. Composer assembles sentences into coherent paragraphs
 * 4. ToneAdapter adjusts language (technical vs plain English)
 */

import { linearRegression, mean, stddev } from "./stats";
import type { ChartDataItem } from "../../hooks/useDashboardData";
import type { Dimension, Measure } from "./types";
import { DIMENSION_LABELS, MEASURE_LABELS } from "./types";
import type { Anomaly } from "./anomaly";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Types
// ─────────────────────────────────────────────────────────────────────────────

export type NarrativeTone = "technical" | "plain";

export interface StatFact {
  type: "peak" | "trough" | "trend" | "outlier" | "comparison" | "dominance" | "concentration" | "volatility" | "change_point";
  strength: "strong" | "moderate" | "weak";
  /** The key data point(s) this fact references */
  citations: { label: string; value: number }[];
  /** Raw values used for statistical language */
  stats: {
    mean?: number;
    stddev?: number;
    zScore?: number;
    pctOfTotal?: number;
    pctChange?: number;
    r2?: number;
    slope?: number;
    coefficient_of_variation?: number;
  };
}

export interface ChartNarrativeResult {
  /** The dimension being analyzed */
  dimension: Dimension;
  /** The measure being analyzed */
  measure: Measure;
  /** Chart title */
  title: string;
  /** Full narrative paragraph (2-4 sentences) */
  paragraph: string;
  /** Individual sentence components for flexible rendering */
  sentences: string[];
  /** The statistical facts backing this narrative */
  facts: StatFact[];
  /** Confidence in the narrative quality (0-1) */
  confidence: number;
}

export interface KeyFinding {
  /** One-line bullet point */
  text: string;
  /** Priority for ordering (higher = more important) */
  priority: number;
  /** Which chart generated this finding */
  sourceChart: string;
  /** Icon hint for rendering */
  icon: "trending_up" | "trending_down" | "warning" | "insights" | "analytics";
}

export interface DashboardNarrative {
  /** 3-5 key findings summarizing the entire dashboard */
  keyFindings: KeyFinding[];
  /** Per-chart narrative paragraphs */
  chartNarratives: Map<string, ChartNarrativeResult>;
  /** Overall data quality / confidence note */
  dataNote: string | null;
  /** Active filter context for the narrative */
  filterContext: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Statistical Analyzers
// ─────────────────────────────────────────────────────────────────────────────

function findPeakAndTrough(data: ChartDataItem[]): { peak: ChartDataItem; trough: ChartDataItem; peakIdx: number; troughIdx: number } {
  let peakIdx = 0;
  let troughIdx = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].value > data[peakIdx].value) peakIdx = i;
    if (data[i].value < data[troughIdx].value) troughIdx = i;
  }
  return { peak: data[peakIdx], trough: data[troughIdx], peakIdx, troughIdx };
}

function computeConcentration(data: ChartDataItem[]): { topN: number; topPct: number; labels: string[] } {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return { topN: 0, topPct: 0, labels: [] };
  const sorted = [...data].sort((a, b) => b.value - a.value);
  let cumulative = 0;
  const labels: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].value;
    labels.push(sorted[i].label);
    if (cumulative / total >= 0.5) {
      return { topN: i + 1, topPct: Math.round((cumulative / total) * 100), labels: labels.slice(0, i + 1) };
    }
  }
  return { topN: sorted.length, topPct: 100, labels };
}

function detectTrend(values: number[]): { direction: "increasing" | "decreasing" | "flat"; slope: number; r2: number; pctChange: number } {
  if (values.length < 3) return { direction: "flat", slope: 0, r2: 0, pctChange: 0 };
  const reg = linearRegression(values);
  const first = values[0];
  const last = values[values.length - 1];
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;

  let direction: "increasing" | "decreasing" | "flat";
  if (reg.r2 < 0.1 || Math.abs(pctChange) < 5) {
    direction = "flat";
  } else {
    direction = reg.slope > 0 ? "increasing" : "decreasing";
  }

  return { direction, slope: reg.slope, r2: reg.r2, pctChange };
}

function computeVolatility(values: number[]): { cv: number; isVolatile: boolean } {
  const m = mean(values);
  if (m === 0) return { cv: 0, isVolatile: false };
  const cv = stddev(values) / Math.abs(m);
  return { cv, isVolatile: cv > 0.3 };
}

function extractFacts(data: ChartDataItem[], dimension: Dimension, _measure: Measure): StatFact[] {
  if (data.length < 2) return [];
  const facts: StatFact[] = [];
  const values = data.map(d => d.value);
  const m = mean(values);
  const sd = stddev(values);
  const total = values.reduce((s, v) => s + v, 0);

  // Peak detection
  const { peak, trough } = findPeakAndTrough(data);
  if (sd > 0) {
    const peakZ = (peak.value - m) / sd;
    if (peakZ > 1.5) {
      facts.push({
        type: "peak",
        strength: peakZ > 2.5 ? "strong" : peakZ > 2 ? "moderate" : "weak",
        citations: [{ label: peak.label, value: peak.value }],
        stats: { mean: m, stddev: sd, zScore: peakZ, pctOfTotal: total > 0 ? (peak.value / total) * 100 : 0 },
      });
    }

    const troughZ = (m - trough.value) / sd;
    if (troughZ > 1.5 && trough.value !== peak.value) {
      facts.push({
        type: "trough",
        strength: troughZ > 2.5 ? "strong" : troughZ > 2 ? "moderate" : "weak",
        citations: [{ label: trough.label, value: trough.value }],
        stats: { mean: m, stddev: sd, zScore: -troughZ },
      });
    }
  }

  // Trend detection (for time-series dimensions)
  const timeDims: Dimension[] = ["year", "month", "hour", "day_of_week"];
  if (timeDims.includes(dimension) && data.length >= 4) {
    const trend = detectTrend(values);
    if (trend.direction !== "flat") {
      facts.push({
        type: "trend",
        strength: trend.r2 > 0.7 ? "strong" : trend.r2 > 0.4 ? "moderate" : "weak",
        citations: [
          { label: data[0].label, value: data[0].value },
          { label: data[data.length - 1].label, value: data[data.length - 1].value },
        ],
        stats: { slope: trend.slope, r2: trend.r2, pctChange: trend.pctChange },
      });
    }
  }

  // Concentration / dominance (for categorical dimensions)
  const categoricalDims: Dimension[] = ["cause", "severity", "county", "weather", "lighting", "collision_type"];
  if (categoricalDims.includes(dimension) && data.length >= 3) {
    const conc = computeConcentration(data);
    if (conc.topN <= Math.ceil(data.length * 0.3) && conc.topPct >= 50) {
      facts.push({
        type: "concentration",
        strength: conc.topN <= 2 ? "strong" : conc.topN <= 3 ? "moderate" : "weak",
        citations: conc.labels.map(l => {
          const item = data.find(d => d.label === l);
          return { label: l, value: item?.value ?? 0 };
        }),
        stats: { pctOfTotal: conc.topPct },
      });
    }

    // Dominance: top item vs second
    const sorted = [...data].sort((a, b) => b.value - a.value);
    if (sorted.length >= 2 && sorted[1].value > 0) {
      const ratio = sorted[0].value / sorted[1].value;
      if (ratio >= 1.5) {
        facts.push({
          type: "dominance",
          strength: ratio > 3 ? "strong" : ratio > 2 ? "moderate" : "weak",
          citations: [
            { label: sorted[0].label, value: sorted[0].value },
            { label: sorted[1].label, value: sorted[1].value },
          ],
          stats: { pctOfTotal: total > 0 ? (sorted[0].value / total) * 100 : 0 },
        });
      }
    }
  }

  // Volatility
  const vol = computeVolatility(values);
  if (vol.isVolatile && timeDims.includes(dimension)) {
    facts.push({
      type: "volatility",
      strength: vol.cv > 0.6 ? "strong" : vol.cv > 0.4 ? "moderate" : "weak",
      citations: [{ label: peak.label, value: peak.value }, { label: trough.label, value: trough.value }],
      stats: { coefficient_of_variation: vol.cv, mean: m, stddev: sd },
    });
  }

  // Comparison facts for demographic dimensions
  const demoDims: Dimension[] = ["gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket"];
  if (demoDims.includes(dimension) && data.length >= 2) {
    const sorted = [...data].sort((a, b) => b.value - a.value);
    if (sorted.length >= 2 && sorted[1].value > 0) {
      const ratio = sorted[0].value / sorted[1].value;
      facts.push({
        type: "comparison",
        strength: ratio > 2 ? "strong" : ratio > 1.3 ? "moderate" : "weak",
        citations: [
          { label: sorted[0].label, value: sorted[0].value },
          { label: sorted[1].label, value: sorted[1].value },
        ],
        stats: { pctOfTotal: total > 0 ? (sorted[0].value / total) * 100 : 0 },
      });
    }
  }

  return facts.sort((a, b) => {
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    return strengthOrder[b.strength] - strengthOrder[a.strength];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Template Sentences
// ─────────────────────────────────────────────────────────────────────────────

function fmtVal(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function fmtPct(v: number): string {
  return `${Math.abs(v).toFixed(1)}%`;
}

function measureNoun(measure: Measure): string {
  const nouns: Record<string, string> = {
    count: "crashes", killed: "fatalities", injured: "injuries",
    percentage: "share", fatality_rate: "fatality rate",
    yoy_change: "year-over-year change",
    per_100k_population: "crashes per 100K residents",
    per_10k_licensed_drivers: "crashes per 10K drivers",
    per_100_road_miles: "crashes per 100 road miles",
  };
  return nouns[measure] ?? measure;
}

function dimensionContext(dim: Dimension): string {
  const ctx: Record<string, string> = {
    hour: "throughout the day",
    day_of_week: "across the week",
    month: "across months",
    year: "over the years analyzed",
    cause: "by primary cause",
    severity: "by severity level",
    county: "across counties",
    gender: "between genders",
    age_bracket: "across age groups",
    at_fault_gender: "by at-fault driver gender",
    at_fault_age_bracket: "by at-fault driver age",
    weather: "under different weather conditions",
    lighting: "across lighting conditions",
    collision_type: "by collision type",
  };
  return ctx[dim] ?? "";
}

function renderPeakSentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const { label, value } = fact.citations[0];
  const noun = measureNoun(measure);
  const z = fact.stats.zScore ?? 0;

  if (tone === "technical") {
    const sigNote = z >= 2.5 ? "statistically significant" : z >= 2 ? "notable" : "elevated";
    return `${label} shows a ${sigNote} peak of ${fmtVal(value)} ${noun} (${z.toFixed(1)} standard deviations above the mean of ${fmtVal(fact.stats.mean ?? 0)}).`;
  }
  return `${label} stands out with the highest ${noun} at ${fmtVal(value)}, well above the average of ${fmtVal(fact.stats.mean ?? 0)}.`;
}

function renderTroughSentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const { label, value } = fact.citations[0];
  const noun = measureNoun(measure);
  const z = Math.abs(fact.stats.zScore ?? 0);

  if (tone === "technical") {
    return `${label} records the minimum at ${fmtVal(value)} ${noun} (${z.toFixed(1)}σ below mean), suggesting ${noun === "crashes" ? "lower exposure or better safety conditions" : "a notable low point"} during this period.`;
  }
  return `${label} has the fewest ${noun} at ${fmtVal(value)}, significantly lower than average.`;
}

function renderTrendSentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const noun = measureNoun(measure);
  const pctChange = fact.stats.pctChange ?? 0;
  const r2 = fact.stats.r2 ?? 0;
  const direction = pctChange >= 0 ? "increased" : "decreased";
  const from = fact.citations[0];
  const to = fact.citations[1];

  if (tone === "technical") {
    const fitNote = r2 > 0.7 ? "with strong linear fit" : r2 > 0.4 ? "with moderate fit" : "though with substantial variance";
    return `${noun.charAt(0).toUpperCase() + noun.slice(1)} ${direction} ${fmtPct(pctChange)} from ${from.label} (${fmtVal(from.value)}) to ${to.label} (${fmtVal(to.value)}), ${fitNote} (R² = ${r2.toFixed(2)}).`;
  }
  return `${noun.charAt(0).toUpperCase() + noun.slice(1)} have ${direction} by ${fmtPct(pctChange)} from ${from.label} to ${to.label}.`;
}

function renderConcentrationSentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const noun = measureNoun(measure);
  const pct = fact.stats.pctOfTotal ?? 0;
  const labels = fact.citations.map(c => c.label);

  if (tone === "technical") {
    return `Distribution is highly concentrated: ${labels.join(", ")} account for ${fmtPct(pct)} of all ${noun}, indicating a Pareto-like pattern where a small number of categories drive the majority of outcomes.`;
  }
  return `Just ${labels.length === 1 ? labels[0] : labels.join(" and ")} account for ${fmtPct(pct)} of all ${noun}.`;
}

function renderDominanceSentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const noun = measureNoun(measure);
  const top = fact.citations[0];
  const second = fact.citations[1];
  const ratio = second.value > 0 ? (top.value / second.value).toFixed(1) : "significantly more";

  if (tone === "technical") {
    return `${top.label} dominates with ${fmtVal(top.value)} ${noun} (${fmtPct(fact.stats.pctOfTotal ?? 0)} of total), exceeding the next category (${second.label}: ${fmtVal(second.value)}) by a factor of ${ratio}x.`;
  }
  return `${top.label} leads by a wide margin with ${fmtVal(top.value)} ${noun} — ${ratio}x more than the runner-up, ${second.label}.`;
}

function renderComparisonSentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const noun = measureNoun(measure);
  const top = fact.citations[0];
  const second = fact.citations[1];
  const pct = fact.stats.pctOfTotal ?? 0;

  if (tone === "technical") {
    return `${top.label} represents the largest share at ${fmtPct(pct)} of ${noun} (${fmtVal(top.value)}), compared to ${second.label} (${fmtVal(second.value)}).`;
  }
  return `${top.label} accounts for the most ${noun} at ${fmtVal(top.value)}, followed by ${second.label} with ${fmtVal(second.value)}.`;
}

function renderVolatilitySentence(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  const noun = measureNoun(measure);
  const cv = fact.stats.coefficient_of_variation ?? 0;
  const peak = fact.citations[0];
  const trough = fact.citations[1];

  if (tone === "technical") {
    return `The data shows high variability (coefficient of variation = ${(cv * 100).toFixed(0)}%), ranging from ${fmtVal(trough.value)} (${trough.label}) to ${fmtVal(peak.value)} (${peak.label}), suggesting ${noun} are not uniformly distributed across this dimension.`;
  }
  return `There is large variation in ${noun}, swinging from a low of ${fmtVal(trough.value)} (${trough.label}) to a high of ${fmtVal(peak.value)} (${peak.label}).`;
}

function renderFact(fact: StatFact, measure: Measure, tone: NarrativeTone): string {
  switch (fact.type) {
    case "peak": return renderPeakSentence(fact, measure, tone);
    case "trough": return renderTroughSentence(fact, measure, tone);
    case "trend": return renderTrendSentence(fact, measure, tone);
    case "concentration": return renderConcentrationSentence(fact, measure, tone);
    case "dominance": return renderDominanceSentence(fact, measure, tone);
    case "comparison": return renderComparisonSentence(fact, measure, tone);
    case "volatility": return renderVolatilitySentence(fact, measure, tone);
    default: return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Paragraph Composer
// ─────────────────────────────────────────────────────────────────────────────

function buildChartTitle(dimension: Dimension, measure: Measure): string {
  const measureLabel = MEASURE_LABELS[measure];
  const dimLabel = DIMENSION_LABELS[dimension];
  if (measureLabel === "Crash Count") return `Crashes by ${dimLabel}`;
  return `${measureLabel} by ${dimLabel}`;
}

function composeNarrative(
  data: ChartDataItem[],
  dimension: Dimension,
  measure: Measure,
  tone: NarrativeTone,
): ChartNarrativeResult {
  const facts = extractFacts(data, dimension, measure);
  const title = buildChartTitle(dimension, measure);
  const noun = measureNoun(measure);
  const context = dimensionContext(dimension);

  if (facts.length === 0) {
    const total = data.reduce((s, d) => s + d.value, 0);
    const avg = data.length > 0 ? total / data.length : 0;
    const sentence = `The distribution of ${noun} ${context} is relatively uniform, with an average of ${fmtVal(Math.round(avg))} per category and no statistically significant outliers or trends.`;
    return {
      dimension, measure, title,
      paragraph: sentence,
      sentences: [sentence],
      facts: [],
      confidence: 0.3,
    };
  }

  // Select top 2-3 facts for the paragraph
  const selected = facts.slice(0, 3);
  const sentences = selected.map(f => renderFact(f, measure, tone)).filter(Boolean);

  // Add a summary opener if we have multiple facts
  if (sentences.length >= 2) {
    const opener = tone === "technical"
      ? `Analysis of ${noun} ${context} reveals ${selected.length} notable patterns.`
      : `Looking at ${noun} ${context}, several patterns emerge.`;
    sentences.unshift(opener);
  }

  const paragraph = sentences.join(" ");
  const confidence = Math.min(1, 0.4 + facts[0].strength === "strong" ? 0.4 : facts[0].strength === "moderate" ? 0.25 : 0.1);

  return {
    dimension, measure, title,
    paragraph,
    sentences,
    facts,
    confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Key Findings Generator
// ─────────────────────────────────────────────────────────────────────────────

function generateKeyFindings(
  chartNarratives: Map<string, ChartNarrativeResult>,
  anomalies: Anomaly[],
  tone: NarrativeTone,
): KeyFinding[] {
  const findings: KeyFinding[] = [];

  // From chart narratives: extract the strongest fact from each chart
  for (const [chartId, narrative] of chartNarratives) {
    if (narrative.facts.length === 0) continue;
    const topFact = narrative.facts[0];
    const noun = measureNoun(narrative.measure);

    let text: string;
    let icon: KeyFinding["icon"];
    let priority: number;

    switch (topFact.type) {
      case "trend": {
        const pctChange = topFact.stats.pctChange ?? 0;
        const direction = pctChange >= 0 ? "increased" : "decreased";
        icon = pctChange >= 0 ? "trending_up" : "trending_down";
        text = tone === "technical"
          ? `${noun.charAt(0).toUpperCase() + noun.slice(1)} ${direction} ${fmtPct(pctChange)} ${dimensionContext(narrative.dimension)} (R² = ${(topFact.stats.r2 ?? 0).toFixed(2)})`
          : `${noun.charAt(0).toUpperCase() + noun.slice(1)} ${direction} by ${fmtPct(pctChange)} ${dimensionContext(narrative.dimension)}`;
        priority = topFact.strength === "strong" ? 90 : topFact.strength === "moderate" ? 70 : 50;
        break;
      }
      case "peak": {
        const cite = topFact.citations[0];
        icon = "analytics";
        text = tone === "technical"
          ? `${cite.label} is a statistically significant peak (${(topFact.stats.zScore ?? 0).toFixed(1)}σ above mean) with ${fmtVal(cite.value)} ${noun}`
          : `${cite.label} has far more ${noun} (${fmtVal(cite.value)}) than average`;
        priority = topFact.strength === "strong" ? 80 : 60;
        break;
      }
      case "concentration": {
        const labels = topFact.citations.map(c => c.label).join(", ");
        icon = "insights";
        text = tone === "technical"
          ? `${fmtPct(topFact.stats.pctOfTotal ?? 0)} of ${noun} concentrate in ${labels} — a Pareto distribution`
          : `${labels} alone account for ${fmtPct(topFact.stats.pctOfTotal ?? 0)} of all ${noun}`;
        priority = topFact.strength === "strong" ? 75 : 55;
        break;
      }
      case "dominance": {
        const cite = topFact.citations[0];
        icon = "insights";
        text = tone === "technical"
          ? `${cite.label} dominates at ${fmtPct(topFact.stats.pctOfTotal ?? 0)} of ${noun} — a disproportionate share`
          : `${cite.label} alone represents ${fmtPct(topFact.stats.pctOfTotal ?? 0)} of all ${noun}`;
        priority = topFact.strength === "strong" ? 72 : 52;
        break;
      }
      case "comparison": {
        const cite = topFact.citations[0];
        icon = "analytics";
        text = `${cite.label} leads with ${fmtVal(cite.value)} ${noun} (${fmtPct(topFact.stats.pctOfTotal ?? 0)} of total)`;
        priority = 45;
        break;
      }
      default: {
        icon = "insights";
        text = `Notable pattern detected in ${noun} ${dimensionContext(narrative.dimension)}`;
        priority = 30;
      }
    }

    findings.push({ text, priority, sourceChart: chartId, icon });
  }

  // From anomalies: surface critical/high-severity ones
  for (const anomaly of anomalies.filter(a => a.severity === "critical").slice(0, 2)) {
    findings.push({
      text: tone === "technical"
        ? `Anomaly detected: ${anomaly.message} (${anomaly.confidence}% confidence)`
        : anomaly.message,
      priority: 85,
      sourceChart: `${anomaly.dimension}:${anomaly.measure}`,
      icon: "warning",
    });
  }

  // Sort by priority, take top 5
  findings.sort((a, b) => b.priority - a.priority);
  return findings.slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Filter Context Description
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterDescription {
  counties: string[];
  severities: string[];
  causes: string[];
  dateRange?: { start?: string; end?: string };
  flags: string[];
}

function describeFilters(filters: FilterDescription): string {
  const parts: string[] = [];

  if (filters.counties.length > 0) {
    parts.push(filters.counties.length <= 3
      ? `in ${filters.counties.join(", ")}`
      : `across ${filters.counties.length} selected counties`);
  } else {
    parts.push("statewide");
  }

  if (filters.severities.length > 0 && filters.severities.length < 3) {
    parts.push(`for ${filters.severities.join(" and ")} crashes`);
  }

  if (filters.causes.length > 0) {
    parts.push(filters.causes.length <= 2
      ? `involving ${filters.causes.join(" or ")}`
      : `filtered by ${filters.causes.length} crash causes`);
  }

  if (filters.dateRange?.start || filters.dateRange?.end) {
    const start = filters.dateRange.start ?? "earliest data";
    const end = filters.dateRange.end ?? "latest data";
    parts.push(`from ${start} to ${end}`);
  }

  if (filters.flags.length > 0) {
    parts.push(`involving ${filters.flags.join(", ")}`);
  }

  return parts.length > 0
    ? `Showing data ${parts.join(", ")}.`
    : "Showing all California crash data with no filters applied.";
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Main Entry Points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a narrative paragraph for a single chart.
 * This is the per-chart entry point.
 */
export function generateChartNarrative(
  data: ChartDataItem[],
  dimension: Dimension,
  measure: Measure,
  tone: NarrativeTone = "plain",
): ChartNarrativeResult {
  if (!data || data.length === 0) {
    return {
      dimension, measure,
      title: buildChartTitle(dimension, measure),
      paragraph: "No data available for this chart with the current filters.",
      sentences: [],
      facts: [],
      confidence: 0,
    };
  }
  return composeNarrative(data, dimension, measure, tone);
}

/**
 * Generate the full dashboard narrative including key findings
 * and per-chart paragraphs. This is the main entry point.
 */
export function generateDashboardNarrative(
  dataBySlot: Record<string, ChartDataItem[]>,
  charts: { id: string; dimension: Dimension; measure: Measure }[],
  anomalies: Anomaly[],
  filters: FilterDescription,
  tone: NarrativeTone = "plain",
): DashboardNarrative {
  const chartNarratives = new Map<string, ChartNarrativeResult>();
  const keys = Object.keys(dataBySlot);

  for (let idx = 0; idx < charts.length; idx++) {
    const chart = charts[idx];
    const data = dataBySlot[keys[idx]];
    if (!data || data.length < 2) continue;
    const narrative = generateChartNarrative(data, chart.dimension, chart.measure, tone);
    chartNarratives.set(chart.id, narrative);
  }

  const keyFindings = generateKeyFindings(chartNarratives, anomalies, tone);
  const filterContext = describeFilters(filters);

  // Data note: flag if there's very little data
  let dataNote: string | null = null;
  const totalDataPoints = Object.values(dataBySlot).reduce((s, arr) => s + arr.length, 0);
  if (totalDataPoints < 10) {
    dataNote = "Limited data available with current filters. Narratives may be less reliable with small sample sizes.";
  }

  return { keyFindings, chartNarratives, dataNote, filterContext };
}
