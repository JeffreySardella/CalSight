/**
 * CSS variable injection engine.
 *
 * Takes a ThemeCustomization object and computes derived CSS custom properties,
 * then applies them to the document root. This is the runtime bridge between
 * the React state and the CSS variable system that Tailwind resolves against.
 *
 * Key design decision: we inject overrides via a dedicated <style> element
 * rather than inline styles on :root. This means we can cleanly remove all
 * overrides by emptying a single element, and specificity stays predictable
 * (all overrides have the same specificity as `:root {}` in a stylesheet).
 */

import type { ThemeCustomization, CardStyle, Density, TypeScale } from "./types";
import { getTokens } from "./tokens";

const STYLE_ID = "calsight-theme-overrides";

/**
 * From a base RGB string like "87 95 107", generate lighter/darker variants
 * for container and on-container tokens.
 */
function deriveContainerColors(baseRgb: string): { container: string; onContainer: string } {
  const [r, g, b] = baseRgb.split(" ").map(Number);
  // Container: lighten by mixing toward white (80% white)
  const container = [
    Math.round(r + (255 - r) * 0.75),
    Math.round(g + (255 - g) * 0.75),
    Math.round(b + (255 - b) * 0.75),
  ].join(" ");
  // On-container: darken slightly from base
  const onContainer = [
    Math.round(r * 0.85),
    Math.round(g * 0.85),
    Math.round(b * 0.85),
  ].join(" ");
  return { container, onContainer };
}

/**
 * Card style maps to CSS variable overrides.
 */
function cardStyleVars(style: CardStyle): Record<string, string> {
  switch (style) {
    case "minimal":
      return {
        "--card-radius": "0.75rem",
        "--card-shadow": "none",
        "--card-border": "none",
        "--card-bg-opacity": "0.5",
        "--card-backdrop": "none",
      };
    case "bordered":
      return {
        "--card-radius": "0.75rem",
        "--card-shadow": "none",
        "--card-border": "1px solid rgb(var(--outline-variant) / 0.3)",
        "--card-bg-opacity": "1",
        "--card-backdrop": "none",
      };
    case "glass":
      return {
        "--card-radius": "1.25rem",
        "--card-shadow": "0 8px 32px -4px rgba(var(--shadow-rgb), 0.06)",
        "--card-border": "1px solid rgb(var(--outline-variant) / 0.1)",
        "--card-bg-opacity": "0.7",
        "--card-backdrop": "blur(12px) saturate(1.5)",
      };
    case "elevated":
    default:
      return {
        "--card-radius": "1rem",
        "--card-shadow": "0 10px 32px -4px rgba(var(--shadow-rgb), 0.04)",
        "--card-border": "none",
        "--card-bg-opacity": "1",
        "--card-backdrop": "none",
      };
  }
}

/**
 * Density controls chart padding and general spacing.
 */
function densityVars(density: Density): Record<string, string> {
  switch (density) {
    case "compact":
      return {
        "--density-chart-padding": "8px",
        "--density-card-padding": "0.75rem",
        "--density-gap": "0.5rem",
        "--density-chart-height-factor": "0.85",
      };
    case "spacious":
      return {
        "--density-chart-padding": "24px",
        "--density-card-padding": "1.5rem",
        "--density-gap": "1.5rem",
        "--density-chart-height-factor": "1.15",
      };
    case "comfortable":
    default:
      return {
        "--density-chart-padding": "16px",
        "--density-card-padding": "1rem",
        "--density-gap": "1rem",
        "--density-chart-height-factor": "1",
      };
  }
}

/**
 * Typography scale multiplier.
 */
function typeScaleVars(scale: TypeScale): Record<string, string> {
  switch (scale) {
    case "small":
      return {
        "--type-scale-factor": "0.9",
        "--type-heading-size": "0.8125rem",
        "--type-body-size": "0.75rem",
        "--type-label-size": "0.625rem",
      };
    case "large":
      return {
        "--type-scale-factor": "1.15",
        "--type-heading-size": "1rem",
        "--type-body-size": "0.9375rem",
        "--type-label-size": "0.75rem",
      };
    case "default":
    default:
      return {
        "--type-scale-factor": "1",
        "--type-heading-size": "0.875rem",
        "--type-body-size": "0.8125rem",
        "--type-label-size": "0.625rem",
      };
  }
}

/**
 * Build the complete CSS text from a customization object.
 */
export function buildCssOverrides(customization: ThemeCustomization): string {
  const vars: Record<string, string> = {};

  // Color overrides (light mode — dark mode derivation happens via a .dark block)
  const { primary, tertiary, error } = customization.colors;
  vars["--primary"] = primary;
  vars["--tertiary"] = tertiary;
  vars["--error"] = error;

  // Derive container/on-container
  const pDerived = deriveContainerColors(primary);
  vars["--primary-container"] = pDerived.container;
  vars["--on-primary-container"] = pDerived.onContainer;

  const tDerived = deriveContainerColors(tertiary);
  vars["--tertiary-container"] = tDerived.container;
  vars["--on-tertiary-container"] = tDerived.onContainer;

  // Card style
  Object.assign(vars, cardStyleVars(customization.cardStyle));

  // Density
  Object.assign(vars, densityVars(customization.density));

  // Typography
  Object.assign(vars, typeScaleVars(customization.typeScale));

  // Design tokens — inject semantic color tokens derived from the active palette
  const isDark = document.documentElement.classList.contains("dark");
  const tokens = getTokens(customization.chart.palette, isDark, customization.chart.customColors);

  // Severity tokens
  vars["--color-severity-fatal"] = tokens.severity.fatal;
  vars["--color-severity-injury"] = tokens.severity.injury;
  vars["--color-severity-pdo"] = tokens.severity.pdo;

  // Correlation tokens
  vars["--color-correlation-pos"] = tokens.correlation.positive;
  vars["--color-correlation-pos-strong"] = tokens.correlation.positiveStrong;
  vars["--color-correlation-pos-weak"] = tokens.correlation.positiveWeak;
  vars["--color-correlation-neg"] = tokens.correlation.negative;
  vars["--color-correlation-neg-strong"] = tokens.correlation.negativeStrong;
  vars["--color-correlation-neg-weak"] = tokens.correlation.negativeWeak;
  vars["--color-correlation-neutral"] = tokens.correlation.neutral;

  // Chart categorical palette tokens (up to 10 colors)
  tokens.chart.categorical.forEach((color, i) => {
    vars[`--color-chart-${i + 1}`] = color;
  });

  // Map tokens
  tokens.map.choropleth.forEach((color, i) => {
    vars[`--color-map-choropleth-${i + 1}`] = color;
  });
  vars["--color-map-heat-low"] = tokens.map.heatLow;
  vars["--color-map-heat-mid"] = tokens.map.heatMid;
  vars["--color-map-heat-high"] = tokens.map.heatHigh;
  vars["--color-map-fatal-low"] = tokens.map.fatalLow;
  vars["--color-map-fatal-mid"] = tokens.map.fatalMid;
  vars["--color-map-fatal-high"] = tokens.map.fatalHigh;

  // Arbitrary user overrides
  for (const [key, value] of Object.entries(customization.customVars)) {
    vars[`--${key}`] = value;
  }

  // Build CSS text
  const entries = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return `:root {\n${entries}\n}`;
}

/**
 * Apply (or remove) theme overrides to the document.
 * This is idempotent — calling it multiple times just updates the content.
 */
export function injectThemeCss(customization: ThemeCustomization | null): void {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  if (!customization) {
    styleEl?.remove();
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.setAttribute("data-theme", "calsight-custom");
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = buildCssOverrides(customization);
}

/**
 * Remove all custom theme overrides, restoring the base CSS.
 */
export function clearThemeCss(): void {
  injectThemeCss(null);
}
