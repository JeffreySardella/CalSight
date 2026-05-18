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
import { getChartPalette, getPaletteSeverity } from "./palettes";

export interface ThemeColors {
  primary: string;
  tertiary: string;
  error: string;
}

function rgbToHex(rgb: string): string {
  const [r, g, b] = rgb.split(" ").map(Number);
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`;
}

function lighten(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `#${[r, g, b].map((c) => Math.min(255, Math.round(c + (255 - c) * amount)).toString(16).padStart(2, "0")).join("")}`;
}

function darken(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `#${[r, g, b].map((c) => Math.max(0, Math.round(c * (1 - amount))).toString(16).padStart(2, "0")).join("")}`;
}

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
 * Resolve all design tokens for the given palette and mode.
 *
 * The 3 theme colors (primary/tertiary/error) drive severity + correlation:
 *   error    → fatal severity, correlation negative
 *   tertiary → injury severity
 *   primary  → PDO severity, correlation positive
 */
export function getTokens(
  paletteKey: ChartPaletteKey,
  isDark: boolean,
  customColors?: string[],
  choroplethColors?: readonly string[],
  themeColors?: ThemeColors,
): DesignTokens {
  const categorical = getChartPalette(paletteKey, customColors);
  const choropleth = choroplethColors ?? deriveChoroplethScale(categorical);

  // Severity colors come from the palette — each palette has hand-picked
  // fatal/injury/pdo colors. Custom theme colors override if provided.
  const paletteSev = getPaletteSeverity(paletteKey);
  const fatalHex = themeColors ? rgbToHex(themeColors.error) : paletteSev.fatal;
  const injuryHex = themeColors ? rgbToHex(themeColors.tertiary) : paletteSev.injury;
  const pdoHex = themeColors ? rgbToHex(themeColors.primary) : paletteSev.pdo;

  const severity: SeverityTokens = isDark
    ? { fatal: lighten(fatalHex, 0.2), injury: lighten(injuryHex, 0.2), pdo: lighten(pdoHex, 0.3) }
    : { fatal: fatalHex, injury: injuryHex, pdo: pdoHex };

  const correlation: CorrelationTokens = isDark
    ? {
        positive: lighten(pdoHex, 0.3),
        positiveStrong: lighten(pdoHex, 0.15),
        positiveWeak: darken(pdoHex, 0.3),
        negative: lighten(fatalHex, 0.2),
        negativeStrong: lighten(fatalHex, 0.1),
        negativeWeak: darken(fatalHex, 0.4),
        neutral: "#3f3f46",
      }
    : {
        positive: lighten(pdoHex, 0.2),
        positiveStrong: pdoHex,
        positiveWeak: lighten(pdoHex, 0.5),
        negative: lighten(fatalHex, 0.1),
        negativeStrong: fatalHex,
        negativeWeak: lighten(fatalHex, 0.45),
        neutral: "#e5e7eb",
      };

  // Heatmap gradient derived from the fatal color
  const fR = parseInt(fatalHex.replace("#", "").slice(0, 2), 16);
  const fG = parseInt(fatalHex.replace("#", "").slice(2, 4), 16);
  const fB = parseInt(fatalHex.replace("#", "").slice(4, 6), 16);
  const heatmap = {
    heatLow: `rgba(${fR}, ${fG}, ${fB}, ${isDark ? 0.12 : 0.15})`,
    heatMid: `rgba(${fR}, ${fG}, ${fB}, ${isDark ? 0.45 : 0.5})`,
    heatHigh: `rgba(${fR}, ${fG}, ${fB}, ${isDark ? 0.95 : 0.9})`,
    fatalLow: `rgba(${fR}, ${fG}, ${fB}, 0.3)`,
    fatalMid: `rgba(${fR}, ${fG}, ${fB}, 0.6)`,
    fatalHigh: `rgba(${fR}, ${fG}, ${fB}, 1)`,
  };

  return {
    severity,
    correlation,
    map: { choropleth, ...heatmap },
    chart: { categorical },
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
