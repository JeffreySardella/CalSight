/**
 * Design tokens — the single source of truth for all colors in CalSight.
 *
 * This module defines semantic color tokens that every component should use
 * instead of hardcoded hex values. Tokens are organized into categories:
 *
 * - severity: fatal, injury, pdo crash dot/badge colors
 * - correlation: positive/negative heatmap cell colors
 * - chart: categorical palette (from user-selected palette)
 * - map: choropleth scale, heatmap gradient stops
 *
 * The `getTokens()` function resolves all tokens for a given palette + mode.
 * The `cssInjector` injects these as CSS custom properties so pure-CSS
 * components can consume them, while the `useDesignTokens` hook exposes them
 * to JS-land (needed for Leaflet map layers).
 */

import type { ChartPaletteKey } from "./types";
import { getChartPalette } from "./palettes";

export interface SeverityTokens {
  fatal: string;
  injury: string;
  pdo: string;
}

export interface CorrelationTokens {
  positive: string;
  positiveStrong: string;
  positiveWeak: string;
  negative: string;
  negativeStrong: string;
  negativeWeak: string;
  neutral: string;
}

export interface MapTokens {
  /** Choropleth scale — 5 colors from low to high */
  choropleth: readonly string[];
  /** Heatmap gradient stops: [low, mid, high] */
  heatLow: string;
  heatMid: string;
  heatHigh: string;
  /** Fatal-specific heatmap gradient */
  fatalLow: string;
  fatalMid: string;
  fatalHigh: string;
}

export interface ChartTokens {
  /** Categorical palette — up to 10 colors for multi-series charts */
  categorical: readonly string[];
}

export interface DesignTokens {
  severity: SeverityTokens;
  correlation: CorrelationTokens;
  map: MapTokens;
  chart: ChartTokens;
}

/**
 * Severity defaults — semantically meaningful colors that convey danger level.
 * These have sensible defaults regardless of the active chart palette.
 */
const SEVERITY_LIGHT: SeverityTokens = {
  fatal: "#dc2626",
  injury: "#f59e0b",
  pdo: "#6b7280",
};

const SEVERITY_DARK: SeverityTokens = {
  fatal: "#ef4444",
  injury: "#fbbf24",
  pdo: "#9ca3af",
};

/**
 * Correlation color scale — blue for positive, red for negative.
 * Maintains the semantic meaning of blue=positive, red=negative.
 */
const CORRELATION_LIGHT: CorrelationTokens = {
  positive: "#3b82f6",
  positiveStrong: "#1d4ed8",
  positiveWeak: "#93c5fd",
  negative: "#ef4444",
  negativeStrong: "#991b1b",
  negativeWeak: "#fca5a5",
  neutral: "#e5e7eb",
};

const CORRELATION_DARK: CorrelationTokens = {
  positive: "#60a5fa",
  positiveStrong: "#3b82f6",
  positiveWeak: "#1e40af",
  negative: "#f87171",
  negativeStrong: "#ef4444",
  negativeWeak: "#7f1d1d",
  neutral: "#3f3f46",
};

/**
 * Map heatmap gradient defaults. These are intentionally warm-red since
 * they represent crash density / severity — "danger" semantics.
 */
const MAP_HEATMAP_LIGHT = {
  heatLow: "rgba(255, 237, 160, 0.4)",
  heatMid: "rgba(252, 141, 98, 0.7)",
  heatHigh: "rgba(227, 26, 28, 0.9)",
  fatalLow: "rgba(255, 80, 60, 0.4)",
  fatalMid: "rgba(220, 40, 30, 0.7)",
  fatalHigh: "rgba(180, 20, 15, 1)",
};

const MAP_HEATMAP_DARK = {
  heatLow: "rgba(255, 237, 160, 0.3)",
  heatMid: "rgba(252, 141, 98, 0.6)",
  heatHigh: "rgba(239, 68, 68, 0.95)",
  fatalLow: "rgba(255, 100, 80, 0.4)",
  fatalMid: "rgba(239, 68, 68, 0.7)",
  fatalHigh: "rgba(220, 38, 38, 1)",
};

/**
 * Resolve all design tokens for the given palette and mode.
 *
 * @param paletteKey - The active chart palette key from settings
 * @param isDark - Whether dark mode is active
 * @param customColors - Custom palette colors (used when paletteKey is "custom")
 * @param choroplethColors - Optional override for the choropleth scale (from the map palette system)
 */
export function getTokens(
  paletteKey: ChartPaletteKey,
  isDark: boolean,
  customColors?: string[],
  choroplethColors?: readonly string[],
): DesignTokens {
  const categorical = getChartPalette(paletteKey, customColors);

  // For the choropleth, use the provided map palette if available,
  // otherwise derive a 5-stop scale from the categorical palette.
  const choropleth = choroplethColors ?? deriveChoroplethScale(categorical);

  return {
    severity: isDark ? SEVERITY_DARK : SEVERITY_LIGHT,
    correlation: isDark ? CORRELATION_DARK : CORRELATION_LIGHT,
    map: {
      choropleth,
      ...(isDark ? MAP_HEATMAP_DARK : MAP_HEATMAP_LIGHT),
    },
    chart: {
      categorical,
    },
  };
}

/**
 * Derive a 5-color choropleth scale from the categorical palette.
 * Picks evenly-spaced colors from the palette array.
 */
function deriveChoroplethScale(palette: readonly string[]): readonly string[] {
  if (palette.length >= 5) {
    const step = (palette.length - 1) / 4;
    return [
      palette[0],
      palette[Math.round(step)],
      palette[Math.round(step * 2)],
      palette[Math.round(step * 3)],
      palette[palette.length - 1],
    ];
  }
  return palette.slice(0, 5);
}

/**
 * Convert a hex color to an rgba string with the given alpha.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Get the correlation cell color for a given r-value.
 * This replaces the hardcoded colorForR function in CorrelationMatrix.
 */
export function correlationColor(r: number, tokens: CorrelationTokens): string {
  if (r >= 0.7) return tokens.positiveStrong;
  if (r >= 0.4) return tokens.positive;
  if (r >= 0.2) return tokens.positiveWeak;
  if (r > -0.2) return tokens.neutral;
  if (r > -0.4) return tokens.negativeWeak;
  if (r > -0.7) return tokens.negative;
  return tokens.negativeStrong;
}

/**
 * Get the scatter dot color based on correlation sign.
 */
export function correlationDotColor(r: number, tokens: CorrelationTokens): string {
  return r >= 0 ? tokens.positive : tokens.negative;
}
