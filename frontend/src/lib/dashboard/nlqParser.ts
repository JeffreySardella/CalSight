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
  ["mode of travel", "mode"], ["road user", "mode"], ["by mode", "mode"], ["travel mode", "mode"],
  ["pedestrians vs cyclists", "mode"], ["pedestrian vs cyclist", "mode"], ["peds vs bikes", "mode"],
  ["motorcyclist", "mode"], ["pedestrian", "mode"], ["cyclist", "mode"],
];

const MEASURE_SYNONYMS: [string, Measure][] = [
  ["killed or seriously injured", "ksi"], ["seriously injured", "ksi"], ["serious injuries", "ksi"], ["ksi", "ksi"],
  ["deaths per 1,000 crashes", "fatality_rate"], ["deaths per 1000 crashes", "fatality_rate"], ["per 1,000 crashes", "fatality_rate"], ["per 1000 crashes", "fatality_rate"],
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

// Filter words the chart box cannot fold into a dimension: a chart is only a
// dimension and a measure. A word with a real toggle in the Filters sheet
// (FILTER_WORD_MAP) is applied there via NlqResult.filters instead of being
// dropped; the rest are reported back as ignored so nothing disappears
// silently.
const FILTER_WORDS: RegExp[] = [
  /\bpedestrians?\b/i, /\bbicyclists?\b/i, /\bcyclists?\b/i, /\bbikes?\b/i,
  /\bmotorcyclists?\b/i, /\bmotorcycles?\b/i,
  /\bdui\b/i, /\bdrunk\b/i, /\balcohol\b/i, /\bimpaired\b/i, /\bdrugs?\b/i,
  /\bdistracted\b/i, /\bhit[- ]and[- ]run\b/i, /\bspeeding\b/i,
];
// Road-user words the mode dimension answers itself ("pedestrians vs cyclists").
const MODE_WORDS = /^(pedestrians?|(bi)?cyclists?|bikes?|motorcyclists?|motorcycles?)$/i;

export type NlqFilterUpdate =
  | { type: "bool"; key: "pedestrian" | "cyclist" | "alcohol" | "drug" | "distracted" }
  | { type: "cause"; value: string };

// Words that have a real filter to land in (StatsFilters booleans, or a
// CAUSES value). No entry here for motorcyclist/motorcycle or hit-and-run:
// there's no boolean flag for either, so those stay in `ignored`.
const FILTER_WORD_MAP: [RegExp, NlqFilterUpdate][] = [
  [/\bpedestrians?\b/i, { type: "bool", key: "pedestrian" }],
  [/\b(bi)?cyclists?\b/i, { type: "bool", key: "cyclist" }],
  [/\bbikes?\b/i, { type: "bool", key: "cyclist" }],
  [/\bdui\b/i, { type: "bool", key: "alcohol" }],
  [/\bdrunk\b/i, { type: "bool", key: "alcohol" }],
  [/\balcohol\b/i, { type: "bool", key: "alcohol" }],
  [/\bimpaired\b/i, { type: "bool", key: "alcohol" }],
  [/\bdrugs?\b/i, { type: "bool", key: "drug" }],
  [/\bdistracted\b/i, { type: "bool", key: "distracted" }],
  [/\bspeeding\b/i, { type: "cause", value: "speeding" }],
];

const FILTER_UPDATE_LABELS: Record<string, string> = {
  pedestrian: "pedestrian", cyclist: "cyclist", alcohol: "alcohol-involved",
  drug: "drug-involved", distracted: "distracted driving", speeding: "speeding",
};

export function describeFilterUpdate(f: NlqFilterUpdate): string {
  const key = f.type === "bool" ? f.key : f.value;
  return FILTER_UPDATE_LABELS[key] ?? key;
}

export interface NlqResult {
  dimension: Dimension | null;
  measure: Measure | null;
  chartType: ChartType | null;
  options: ChartOptions;
  confidence: "high" | "medium" | "low";
  /** Filter words the chart cannot reflect and that have no filter to apply either. */
  ignored: string[];
  /** Filter words that map to a real toggle in the Filters sheet — apply these, don't just report them. */
  filters: NlqFilterUpdate[];
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

  const ignored: string[] = [];
  const filters: NlqFilterUpdate[] = [];
  const seenFilters = new Set<string>();
  for (const re of FILTER_WORDS) {
    const word = re.exec(input)?.[0].toLowerCase();
    if (!word) continue;
    // The mode dimension already answers a road-user word directly.
    if (dimension === "mode" && MODE_WORDS.test(word)) continue;
    const mapping = FILTER_WORD_MAP.find(([wordRe]) => wordRe.test(word));
    if (!mapping) {
      ignored.push(word);
      continue;
    }
    const update = mapping[1];
    const dedupeKey = update.type === "bool" ? `bool:${update.key}` : `cause:${update.value}`;
    if (seenFilters.has(dedupeKey)) continue;
    seenFilters.add(dedupeKey);
    filters.push(update);
  }

  const matched = [dimension, measure, chartType].filter(Boolean).length;
  // A dropped word means the chart answers a different question: one step down.
  // A word folded into `filters` isn't dropped, so it doesn't cost a level.
  const level = Math.min(matched, 2) - (ignored.length > 0 ? 1 : 0);
  const confidence = (["low", "medium", "high"] as const)[Math.max(0, level)];

  return { dimension, measure, chartType, options, confidence, ignored, filters };
}

export function resolveNlq(result: NlqResult): { dimension: Dimension; measure: Measure; chartType: ChartType; options: ChartOptions } | null {
  const dimension = result.dimension ?? "year";
  // KSI is year-only (see ChartConfigPanel); elsewhere show deaths instead.
  const measure = result.measure === "ksi" && dimension !== "year" ? "killed" : result.measure ?? "count";
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
