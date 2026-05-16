export const DIMENSIONS = [
  "hour", "day_of_week", "month", "year", "cause", "severity",
  "county", "gender", "age_bracket", "at_fault_gender", "at_fault_age_bracket",
  "weather", "lighting", "collision_type",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const MEASURES = [
  "count", "killed", "injured", "per_100k_population",
  "per_10k_licensed_drivers", "per_100_road_miles", "percentage",
] as const;

export type Measure = (typeof MEASURES)[number];

export type ChartType = "bar" | "hbar" | "line" | "area" | "donut" | "treemap" | "gauge" | "stat" | "polar" | "lollipop" | "radar";

export type ChartSlot = {
  id: string;
  dimension: Dimension;
  measure: Measure;
  chartType: ChartType;
  splitBy?: Dimension;
  order: number;
};

export type PresetKey = "overview" | "time" | "demographics" | "rates" | "dui" | "seasonal";

export type DashboardConfig = {
  mode: "simple" | "advanced";
  preset: PresetKey;
  charts: ChartSlot[];
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  hour: "Hour of Day",
  day_of_week: "Day of Week",
  month: "Month",
  year: "Year",
  cause: "Primary Cause",
  severity: "Severity",
  county: "County",
  gender: "Victim Gender",
  age_bracket: "Victim Age",
  at_fault_gender: "At-Fault Gender",
  at_fault_age_bracket: "At-Fault Age",
  weather: "Weather",
  lighting: "Lighting",
  collision_type: "Collision Type",
};

export const MEASURE_LABELS: Record<Measure, string> = {
  count: "Crash Count",
  killed: "Fatalities",
  injured: "Injuries",
  per_100k_population: "Per 100K Population",
  per_10k_licensed_drivers: "Per 10K Drivers",
  per_100_road_miles: "Per 100 Road Miles",
  percentage: "Percentage",
};

const DEFAULT_CHART_TYPE: Partial<Record<Dimension, ChartType>> = {
  severity: "donut",
  year: "area",
  hour: "bar",
  cause: "hbar",
  county: "hbar",
  month: "bar",
  day_of_week: "bar",
  weather: "hbar",
  lighting: "hbar",
  collision_type: "hbar",
};

export function defaultChartType(dim: Dimension): ChartType {
  return DEFAULT_CHART_TYPE[dim] ?? "bar";
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
