import { describe, it, expect } from "vitest";
import { primaryForMode } from "./cssInjector";
import { getDefaultCustomization } from "./presets";

/** WCAG relative luminance + contrast ratio for "r g b" token strings. */
function luminance(rgb: string): number {
  const [r, g, b] = rgb.split(" ").map(Number).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// --on-primary tokens from index.css (light :root / .dark) — the text color
// painted on a --primary background.
const ON_PRIMARY_LIGHT = "246 247 255";
const ON_PRIMARY_DARK = "38 45 56";

describe("primary button contrast (WCAG 1.4.3 AA, ≥4.5:1)", () => {
  const defaultPrimary = getDefaultCustomization().colors.primary;

  it("default primary on --on-primary passes in light mode", () => {
    const ratio = contrast(primaryForMode(defaultPrimary, false), ON_PRIMARY_LIGHT);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("default primary on --on-primary passes in dark mode", () => {
    const ratio = contrast(primaryForMode(defaultPrimary, true), ON_PRIMARY_DARK);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
