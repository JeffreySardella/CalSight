/**
 * Chart color palettes for the theming system.
 *
 * Each palette provides an ordered array of hex colors designed for
 * qualitative data (categories, not sequential scales). The palettes
 * are ordered so adjacent colors have maximum contrast.
 */

import type { ChartPaletteKey } from "./types";

export const CHART_PALETTES: Record<Exclude<ChartPaletteKey, "custom">, readonly string[]> = {
  /** Balanced blue-purple-teal — the default MD3-inspired palette */
  default: [
    "#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
    "#ef4444", "#ec4899", "#84cc16", "#14b8a6", "#f97316",
  ],

  /** Reds, oranges, golds — warm energy */
  warm: [
    "#dc2626", "#ea580c", "#d97706", "#ca8a04", "#b91c1c",
    "#c2410c", "#a16207", "#854d0e", "#f59e0b", "#ef4444",
  ],

  /** Blues, teals, cyans — cool and calm */
  cool: [
    "#2563eb", "#0891b2", "#0d9488", "#6366f1", "#0ea5e9",
    "#4f46e5", "#7c3aed", "#0284c7", "#059669", "#1d4ed8",
  ],

  /** Deep blues and aquas — ocean depths */
  ocean: [
    "#1e3a5f", "#0c4a6e", "#0369a1", "#0284c7", "#0ea5e9",
    "#38bdf8", "#22d3ee", "#06b6d4", "#155e75", "#164e63",
  ],

  /** Greens and earth tones — natural growth */
  forest: [
    "#166534", "#15803d", "#22c55e", "#65a30d", "#ca8a04",
    "#a16207", "#854d0e", "#365314", "#4d7c0f", "#16a34a",
  ],

  /** Oranges through purples — sunset gradient */
  sunset: [
    "#dc2626", "#ea580c", "#f59e0b", "#d946ef", "#7c3aed",
    "#db2777", "#e11d48", "#c026d3", "#9333ea", "#f97316",
  ],

  /** Okabe-Ito palette — optimized for deuteranopia and protanopia */
  colorblind: [
    "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2",
    "#D55E00", "#CC79A7", "#000000", "#999999", "#661100",
  ],

  /** Shades of a single hue — good for ordered categories */
  monochrome: [
    "#1e293b", "#334155", "#475569", "#64748b", "#94a3b8",
    "#cbd5e1", "#e2e8f0", "#f1f5f9", "#0f172a", "#1e293b",
  ],
};

/**
 * Severity color presets per palette — hand-picked to match each palette's feel.
 * fatal = most dangerous, injury = moderate, pdo = least severe
 */
export const PALETTE_SEVERITY: Record<Exclude<ChartPaletteKey, "custom">, { fatal: string; injury: string; pdo: string }> = {
  default:    { fatal: "#ef4444", injury: "#8b5cf6", pdo: "#6366f1" },
  warm:       { fatal: "#dc2626", injury: "#ea580c", pdo: "#d97706" },
  cool:       { fatal: "#4f46e5", injury: "#0891b2", pdo: "#2563eb" },
  ocean:      { fatal: "#0c4a6e", injury: "#0369a1", pdo: "#0ea5e9" },
  forest:     { fatal: "#854d0e", injury: "#65a30d", pdo: "#166534" },
  sunset:     { fatal: "#dc2626", injury: "#d946ef", pdo: "#ea580c" },
  colorblind: { fatal: "#D55E00", injury: "#E69F00", pdo: "#0072B2" },
  monochrome: { fatal: "#1e293b", injury: "#64748b", pdo: "#94a3b8" },
};

/**
 * Get the palette colors for a given key.
 * For "custom", falls back to the user-provided array.
 */
export function getChartPalette(key: ChartPaletteKey, customColors?: string[]): readonly string[] {
  if (key === "custom" && customColors?.length) return customColors;
  if (key === "custom") return CHART_PALETTES.default;
  return CHART_PALETTES[key];
}

/**
 * Get severity colors for a given palette.
 */
export function getPaletteSeverity(key: ChartPaletteKey): { fatal: string; injury: string; pdo: string } {
  if (key === "custom") return PALETTE_SEVERITY.default;
  return PALETTE_SEVERITY[key];
}

/**
 * Cycle through palette colors for a given index.
 */
export function paletteColor(palette: readonly string[], index: number): string {
  return palette[index % palette.length];
}
