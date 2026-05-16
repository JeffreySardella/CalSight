import { describe, it, expect } from "vitest";
import { PRESETS, PRESET_KEYS, buildPresetCharts } from "./presets";
import { DIMENSIONS, MEASURES } from "./types";

describe("presets", () => {
  it("every preset key is in PRESET_KEYS", () => {
    expect(PRESET_KEYS).toEqual(Object.keys(PRESETS));
  });

  it("all preset slots use valid dimensions and measures", () => {
    for (const key of PRESET_KEYS) {
      for (const slot of PRESETS[key].slots) {
        expect(DIMENSIONS).toContain(slot.dimension);
        expect(MEASURES).toContain(slot.measure);
      }
    }
  });

  it("buildPresetCharts returns slots with unique ids", () => {
    const charts = buildPresetCharts("overview");
    const ids = charts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(charts.length).toBe(PRESETS.overview.slots.length);
  });

  it("all presets have label, icon, and description", () => {
    for (const key of PRESET_KEYS) {
      const p = PRESETS[key];
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
