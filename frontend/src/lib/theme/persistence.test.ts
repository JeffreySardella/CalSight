// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadCustomization } from "./persistence";
import { getDefaultCustomization } from "./presets";

const KEY = "calsight-theme-customization";

beforeEach(() => localStorage.clear());

describe("loadCustomization — resilient to corrupt/legacy stored themes (M-F2)", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadCustomization()).toEqual(getDefaultCustomization());
  });

  it("does not crash and heals a stored theme whose colors is the wrong type", () => {
    // The old shape check only tested truthiness, so a string `colors` passed
    // through and blew up downstream, crashing the app into a reload loop.
    localStorage.setItem(KEY, JSON.stringify({
      activePreset: "custom",
      colors: "corrupt",
      chart: { palette: "default", customColors: [] },
      cardStyle: "elevated",
      density: "comfortable",
      typeScale: "default",
      customVars: {},
    }));
    const result = loadCustomization();
    expect(typeof result.colors.primary).toBe("string");
    expect(typeof result.colors.error).toBe("string");
  });

  it("fills missing nested fields from the default (legacy partial theme)", () => {
    localStorage.setItem(KEY, JSON.stringify({ colors: { primary: "1 2 3" } }));
    const result = loadCustomization();
    expect(result.colors.primary).toBe("1 2 3");           // kept
    expect(Array.isArray(result.chart.customColors)).toBe(true); // filled
    expect(result.cardStyle).toBe(getDefaultCustomization().cardStyle);
  });

  it("coerces a non-array customColors to the default", () => {
    localStorage.setItem(KEY, JSON.stringify({
      chart: { palette: "custom", customColors: "nope" },
    }));
    expect(Array.isArray(loadCustomization().chart.customColors)).toBe(true);
  });

  it("returns the default and clears the key on unparseable JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadCustomization()).toEqual(getDefaultCustomization());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("preserves a fully valid stored theme", () => {
    const valid = { ...getDefaultCustomization(), activePreset: "midnight" as const, colors: { primary: "10 20 30", tertiary: "40 50 60", error: "70 80 90" } };
    localStorage.setItem(KEY, JSON.stringify(valid));
    expect(loadCustomization()).toEqual(valid);
  });
});
