import type { Dimension, Measure, ChartType, ChartOptions } from "./types";
import { defaultChartType } from "./types";

const DIMENSION_SYNONYMS: [string, Dimension][] = [
  ["hour of day", "hour"], ["time of day", "hour"], ["hourly", "hour"], ["hour", "hour"],
  ["day of week", "day_of_week"], ["day of the week", "day_of_week"], ["weekday", "day_of_week"], ["daily", "day_of_week"], ["day", "day_of_week"],
  ["monthly", "month"], ["month", "month"],
  ["yearly", "year"], ["annual", "year"], ["over time", "year"], ["year", "year"],
  ["primary cause", "cause"], ["causes", "cause"], ["reason", "cause"], ["cause", "cause"],
  ["crash severity", "severity"], ["severity", "severity"],
  ["counties", "county"], ["location", "county"], ["region", "county"], ["county", "county"],
  ["at-fault gender", "at_fault_gender"], ["at fault gender", "at_fault_gender"], ["driver gender", "at_fault_gender"],
  ["at-fault age", "at_fault_age_bracket"], ["at fault age", "at_fault_age_bracket"], ["driver age", "at_fault_age_bracket"],
  ["victim gender", "gender"], ["gender", "gender"],
  ["victim age", "age_bracket"], ["age group", "age_bracket"], ["age bracket", "age_bracket"], ["age", "age_bracket"],
  ["weather condition", "weather"], ["weather", "weather"],
  ["visibility", "lighting"], ["lighting", "lighting"],
  ["collision type", "collision_type"], ["crash type", "collision_type"], ["type of collision", "collision_type"],
];

const MEASURE_SYNONYMS: [string, Measure][] = [
  ["fatality rate", "fatality_rate"], ["death rate", "fatality_rate"], ["kill rate", "fatality_rate"],
  ["year over year", "yoy_change"], ["yoy change", "yoy_change"], ["yoy", "yoy_change"],
  ["per capita", "per_100k_population"], ["per 100k", "per_100k_population"], ["per population", "per_100k_population"],
  ["per driver", "per_10k_licensed_drivers"], ["per 10k drivers", "per_10k_licensed_drivers"],
  ["per mile", "per_100_road_miles"], ["per road mile", "per_100_road_miles"],
  ["fatalities", "killed"], ["deaths", "killed"], ["fatal", "killed"], ["killed", "killed"],
  ["injuries", "injured"], ["injured", "injured"], ["hurt", "injured"],
  ["percentage", "percentage"], ["percent", "percentage"], ["proportion", "percentage"], ["share", "percentage"],
  ["crashes", "count"], ["incidents", "count"], ["number", "count"], ["total", "count"], ["count", "count"],
];

const CHART_TYPE_SYNONYMS: [string, ChartType][] = [
  ["horizontal bar", "hbar"], ["h-bar", "hbar"], ["hbar", "hbar"],
  ["bar chart", "bar"], ["bar graph", "bar"], ["column", "bar"], ["bars", "bar"], ["bar", "bar"],
  ["line chart", "line"], ["line graph", "line"], ["trend", "line"], ["trends", "line"], ["line", "line"],
  ["area chart", "area"], ["filled line", "area"], ["area", "area"],
  ["doughnut", "donut"], ["pie chart", "donut"], ["pie", "donut"], ["ring", "donut"], ["donut", "donut"],
  ["tree map", "treemap"], ["treemap", "treemap"],
  ["scatter plot", "scatter"], ["scatterplot", "scatter"], ["dots", "scatter"], ["scatter", "scatter"],
  ["spider chart", "radar"], ["spider", "radar"], ["radar", "radar"],
  ["polar chart", "polar"], ["polar", "polar"],
  ["lollipop", "lollipop"],
  ["speedometer", "gauge"], ["gauge", "gauge"],
  ["big number", "stat"], ["number card", "stat"], ["stat card", "stat"], ["stat", "stat"],
];

const OPTION_PATTERNS: [RegExp, Partial<ChartOptions>][] = [
  [/\btrend\s*line\b/i, { trendLine: true }],
  [/\bcumulative\b/i, { cumulative: true }],
  [/\blog\s*scale\b/i, { logScale: true }],
  [/\bmoving\s*average\b/i, { movingAvg: 3 }],
  [/\bmean\s*line\b/i, { meanLine: true }],
  [/\bstd\s*band\b|standard\s*deviation/i, { stdBand: true }],
  [/\boutlier/i, { outliers: true }],
  [/\bforecast\b/i, { forecast: true }],
];

export interface NlqResult {
  dimension: Dimension | null;
  measure: Measure | null;
  chartType: ChartType | null;
  options: ChartOptions;
  confidence: "high" | "medium" | "low";
}

function matchFirst(input: string, synonyms: [string, string][]): string | null {
  const lower = input.toLowerCase();
  for (const [phrase, value] of synonyms) {
    if (lower.includes(phrase)) return value;
  }
  return null;
}

export function parseNlq(input: string): NlqResult {
  const dimension = matchFirst(input, DIMENSION_SYNONYMS) as Dimension | null;
  const measure = matchFirst(input, MEASURE_SYNONYMS) as Measure | null;

  // Parse options first and strip matched text so option phrases like
  // "trend line" don't accidentally match chart type synonyms like "line".
  const options: ChartOptions = {};
  let chartTypeInput = input;
  for (const [pattern, opts] of OPTION_PATTERNS) {
    if (pattern.test(input)) {
      Object.assign(options, opts);
      chartTypeInput = chartTypeInput.replace(pattern, " ");
    }
  }

  const chartType = matchFirst(chartTypeInput, CHART_TYPE_SYNONYMS) as ChartType | null;

  const matched = [dimension, measure, chartType].filter(Boolean).length;
  const confidence = matched >= 2 ? "high" : matched === 1 ? "medium" : "low";

  return { dimension, measure, chartType, options, confidence };
}

export function resolveNlq(result: NlqResult): { dimension: Dimension; measure: Measure; chartType: ChartType; options: ChartOptions } | null {
  const dimension = result.dimension ?? "year";
  const measure = result.measure ?? "count";
  const chartType = result.chartType ?? defaultChartType(dimension);
  if (result.confidence === "low") return null;
  return { dimension, measure, chartType, options: result.options };
}

export const SUGGESTIONS = [
  "fatalities by county as a scatter plot",
  "crashes by hour",
  "severity breakdown as a donut",
  "injuries over time with trend line",
  "fatality rate by age group",
  "crashes by cause as a treemap",
  "year over year change by month",
  "crashes by day of week as a radar",
  "fatalities by year with forecast",
];
