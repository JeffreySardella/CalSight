import type { DashboardConfig, PresetKey } from "./types";
import { DIMENSIONS, MEASURES } from "./types";
import { PRESET_KEYS } from "./presets";

const VALID_MODES = new Set(["simple", "advanced"]);
const VALID_CHART_TYPES = new Set([
  "bar", "hbar", "line", "area", "donut", "treemap", "gauge",
  "stat", "polar", "lollipop", "radar", "scatter",
]);

/**
 * Structural validation for a persisted/deep-linked DashboardConfig. Used before
 * applying anything that came from localStorage, a saved dashboard, or a URL — a
 * corrupt or older-schema config would otherwise render into a crash. Never
 * throws, even on `charts: [null]`.
 */
export function isValidConfig(p: unknown): p is DashboardConfig {
  if (!p || typeof p !== "object") return false;
  const c = p as Record<string, unknown>;
  if (!VALID_MODES.has(c.mode as string)) return false;
  if (!PRESET_KEYS.includes(c.preset as PresetKey)) return false;
  if (!Array.isArray(c.charts)) return false;
  return c.charts.every((s) => {
    if (!s || typeof s !== "object") return false;
    const chart = s as Record<string, unknown>;
    return (
      typeof chart.id === "string" &&
      typeof chart.order === "number" &&
      (DIMENSIONS as readonly string[]).includes(chart.dimension as string) &&
      (MEASURES as readonly string[]).includes(chart.measure as string) &&
      VALID_CHART_TYPES.has(chart.chartType as string)
    );
  });
}
