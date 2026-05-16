import type { ChartSlot, PresetKey } from "./types";
import { generateId } from "./types";

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
    description: "Severity, causes, hourly patterns, and yearly trends",
    slots: [
      { dimension: "severity", measure: "count", chartType: "donut", order: 0 },
      { dimension: "cause", measure: "count", chartType: "bar", order: 1 },
      { dimension: "hour", measure: "count", chartType: "bar", order: 2 },
      { dimension: "year", measure: "count", chartType: "line", order: 3 },
    ],
  },
  time: {
    label: "Time Patterns",
    icon: "schedule",
    description: "When crashes happen — hour, day, month, year",
    slots: [
      { dimension: "hour", measure: "count", chartType: "bar", order: 0 },
      { dimension: "day_of_week", measure: "count", chartType: "bar", order: 1 },
      { dimension: "month", measure: "count", chartType: "bar", order: 2 },
      { dimension: "year", measure: "count", chartType: "line", order: 3 },
    ],
  },
  demographics: {
    label: "Demographics",
    icon: "group",
    description: "Who is involved — gender, age, at-fault drivers",
    slots: [
      { dimension: "severity", measure: "count", chartType: "donut", order: 0 },
      { dimension: "gender", measure: "count", chartType: "bar", order: 1 },
      { dimension: "age_bracket", measure: "count", chartType: "bar", order: 2 },
      { dimension: "at_fault_gender", measure: "count", chartType: "bar", order: 3 },
      { dimension: "at_fault_age_bracket", measure: "count", chartType: "bar", order: 4 },
    ],
  },
  rates: {
    label: "County Rates",
    icon: "table_chart",
    description: "Per-capita crash rates across counties",
    slots: [
      { dimension: "severity", measure: "count", chartType: "donut", order: 0 },
      { dimension: "cause", measure: "count", chartType: "bar", order: 1 },
      { dimension: "year", measure: "count", chartType: "line", order: 2 },
    ],
  },
  dui: {
    label: "DUI Deep Dive",
    icon: "local_bar",
    description: "Alcohol-related crash patterns and demographics",
    slots: [
      { dimension: "hour", measure: "count", chartType: "bar", order: 0 },
      { dimension: "day_of_week", measure: "count", chartType: "bar", order: 1 },
      { dimension: "at_fault_age_bracket", measure: "count", chartType: "bar", order: 2 },
      { dimension: "at_fault_gender", measure: "count", chartType: "bar", order: 3 },
      { dimension: "year", measure: "count", chartType: "line", order: 4 },
    ],
  },
  seasonal: {
    label: "Seasonal Patterns",
    icon: "thermostat",
    description: "Monthly and weather-related crash trends",
    slots: [
      { dimension: "month", measure: "count", chartType: "bar", order: 0 },
      { dimension: "weather", measure: "count", chartType: "bar", order: 1 },
      { dimension: "lighting", measure: "count", chartType: "bar", order: 2 },
      { dimension: "year", measure: "count", chartType: "line", order: 3 },
    ],
  },
};

export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

export function buildPresetCharts(key: PresetKey): ChartSlot[] {
  return PRESETS[key].slots.map((s) => ({ ...s, id: generateId() }));
}
