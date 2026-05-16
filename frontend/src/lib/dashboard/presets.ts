import type { ChartSlot, PresetKey } from "./types";

type PresetDef = {
  label: string;
  icon: string;
  description: string;
  slots: Omit<ChartSlot, "id">[];
};

export const PRESETS: Record<PresetKey, PresetDef> = {
  overview: {
    label: "Safety Overview",
    icon: "insights",
    description: "High-level crash landscape — severity, causes, and trends",
    slots: [
      { dimension: "severity", measure: "count", chartType: "donut", order: 0 },
      { dimension: "cause", measure: "count", chartType: "hbar", order: 1 },
      { dimension: "year", measure: "count", chartType: "area", order: 2, options: { trendLine: true } },
      { dimension: "county", measure: "count", chartType: "hbar", order: 3 },
    ],
  },
  time: {
    label: "Time Patterns",
    icon: "schedule",
    description: "When crashes happen — hour, day, and month",
    slots: [
      { dimension: "hour", measure: "count", chartType: "bar", order: 0 },
      { dimension: "day_of_week", measure: "count", chartType: "radar", order: 1 },
      { dimension: "month", measure: "count", chartType: "area", order: 2 },
    ],
  },
  demographics: {
    label: "Demographics",
    icon: "group",
    description: "Who is involved — victims and at-fault drivers by gender and age",
    slots: [
      { dimension: "gender", measure: "count", chartType: "bar", order: 0 },
      { dimension: "age_bracket", measure: "count", chartType: "bar", order: 1 },
      { dimension: "at_fault_gender", measure: "count", chartType: "polar", order: 2 },
      { dimension: "at_fault_age_bracket", measure: "count", chartType: "lollipop", order: 3 },
    ],
  },
  rates: {
    label: "Fatality Focus",
    icon: "warning",
    description: "Fatal crashes — who dies, where, and trends over time",
    slots: [
      { dimension: "cause", measure: "killed", chartType: "hbar", order: 0 },
      { dimension: "year", measure: "killed", chartType: "area", order: 1, options: { trendLine: true } },
      { dimension: "age_bracket", measure: "killed", chartType: "lollipop", order: 2 },
      { dimension: "county", measure: "killed", chartType: "hbar", order: 3 },
    ],
  },
  dui: {
    label: "DUI Deep Dive",
    icon: "local_bar",
    description: "Alcohol-related crash patterns and demographics",
    slots: [
      { dimension: "hour", measure: "count", chartType: "bar", order: 0 },
      { dimension: "severity", measure: "count", chartType: "donut", order: 1 },
      { dimension: "at_fault_age_bracket", measure: "count", chartType: "radar", order: 2 },
      { dimension: "day_of_week", measure: "count", chartType: "bar", order: 3 },
    ],
  },
  seasonal: {
    label: "Injury Analysis",
    icon: "local_hospital",
    description: "Injury patterns — when, where, and who gets hurt",
    slots: [
      { dimension: "month", measure: "injured", chartType: "area", order: 0 },
      { dimension: "cause", measure: "injured", chartType: "hbar", order: 1 },
      { dimension: "year", measure: "injured", chartType: "area", order: 2, options: { trendLine: true } },
      { dimension: "county", measure: "injured", chartType: "hbar", order: 3 },
    ],
  },
  equity: {
    label: "Equity & Safety",
    icon: "balance",
    description: "Socioeconomic factors and crash outcomes across communities",
    slots: [
      { dimension: "county", measure: "fatality_rate", chartType: "scatter", order: 0 },
      { dimension: "county", measure: "killed", chartType: "hbar", order: 1 },
      { dimension: "cause", measure: "killed", chartType: "hbar", order: 2 },
      { dimension: "age_bracket", measure: "killed", chartType: "lollipop", order: 3 },
    ],
  },
  comparison: {
    label: "County Comparison",
    icon: "compare",
    description: "Compare counties across multiple dimensions",
    slots: [
      { dimension: "county", measure: "count", chartType: "hbar", order: 0 },
      { dimension: "county", measure: "killed", chartType: "lollipop", order: 1 },
      { dimension: "county", measure: "injured", chartType: "hbar", order: 2 },
      { dimension: "severity", measure: "count", chartType: "donut", order: 3 },
    ],
  },
};

export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

export function buildPresetCharts(key: PresetKey): ChartSlot[] {
  const preset = PRESETS[key] ?? PRESETS.overview;
  return preset.slots.map((s, i) => ({ ...s, id: `preset-${key}-${i}` }));
}
