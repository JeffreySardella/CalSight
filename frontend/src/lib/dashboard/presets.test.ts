import { describe, it, expect } from "vitest";
import { PRESETS, PRESET_KEYS, buildPresetCharts } from "./presets";
import { DIMENSIONS, MEASURES } from "./types";
import type { PresetKey } from "./types";

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

describe("preset slot counts", () => {
  it("overview has 4 slots", () => {
    expect(PRESETS.overview.slots.length).toBe(4);
  });

  it("time has 3 slots", () => {
    expect(PRESETS.time.slots.length).toBe(3);
  });

  it("demographics has 4 slots", () => {
    expect(PRESETS.demographics.slots.length).toBe(4);
  });

  it("rates has 4 slots", () => {
    expect(PRESETS.rates.slots.length).toBe(4);
  });

  it("dui has 4 slots", () => {
    expect(PRESETS.dui.slots.length).toBe(4);
  });

  it("seasonal has 4 slots", () => {
    expect(PRESETS.seasonal.slots.length).toBe(4);
  });

  it("equity has 4 slots", () => {
    expect(PRESETS.equity.slots.length).toBe(4);
  });

  it("comparison has 4 slots", () => {
    expect(PRESETS.comparison.slots.length).toBe(4);
  });

  it("conditions has 4 slots", () => {
    expect(PRESETS.conditions.slots.length).toBe(4);
  });

  it("each preset key produces the correct number of chart slots from buildPresetCharts", () => {
    for (const key of PRESET_KEYS) {
      const charts = buildPresetCharts(key);
      expect(charts.length).toBe(PRESETS[key].slots.length);
    }
  });
});

describe("buildPresetCharts deterministic IDs", () => {
  it("produces deterministic IDs (not random) for each preset", () => {
    for (const key of PRESET_KEYS) {
      const first = buildPresetCharts(key);
      const second = buildPresetCharts(key);
      const firstIds = first.map((c) => c.id);
      const secondIds = second.map((c) => c.id);
      expect(firstIds).toEqual(secondIds);
    }
  });

  it("IDs follow the pattern preset-{key}-{index}", () => {
    for (const key of PRESET_KEYS) {
      const charts = buildPresetCharts(key);
      charts.forEach((chart, i) => {
        expect(chart.id).toBe(`preset-${key}-${i}`);
      });
    }
  });

  it("IDs are unique across all presets", () => {
    const allIds: string[] = [];
    for (const key of PRESET_KEYS) {
      const charts = buildPresetCharts(key);
      allIds.push(...charts.map((c) => c.id));
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("different preset keys produce different IDs", () => {
    const overviewIds = buildPresetCharts("overview").map((c) => c.id);
    const timeIds = buildPresetCharts("time").map((c) => c.id);
    // No overlap between different presets
    for (const id of overviewIds) {
      expect(timeIds).not.toContain(id);
    }
  });
});

describe("buildPresetCharts fallback behavior", () => {
  it("invalid preset key falls back to overview", () => {
    // Force an invalid key through type assertion to test the fallback
    const charts = buildPresetCharts("totally_invalid" as PresetKey);
    const overviewCharts = buildPresetCharts("overview");
    // Should fall back to overview preset
    expect(charts.length).toBe(overviewCharts.length);
    // The slots content should match overview's structure
    for (let i = 0; i < charts.length; i++) {
      expect(charts[i].dimension).toBe(overviewCharts[i].dimension);
      expect(charts[i].measure).toBe(overviewCharts[i].measure);
      expect(charts[i].chartType).toBe(overviewCharts[i].chartType);
    }
  });

  it("invalid preset key produces IDs based on the invalid key name (from spread)", () => {
    // The id pattern uses the key passed in, even if it falls back
    // Based on the code: `preset-${key}-${i}` with the original key
    // Actually looking at the code: PRESETS[key] ?? PRESETS.overview
    // Then id: `preset-${key}-${i}` — so it uses the key passed in
    const charts = buildPresetCharts("fake_key" as PresetKey);
    expect(charts[0].id).toBe("preset-fake_key-0");
  });
});

describe("conditions preset (#293 Crash Conditions)", () => {
  it("covers the weather, lighting, and collision-type dimensions", () => {
    const dims = PRESETS.conditions.slots.map((s) => s.dimension);
    expect(dims).toContain("weather");
    expect(dims).toContain("lighting");
    expect(dims).toContain("collision_type");
  });

  it("applies no filter overrides (first visit stays unfiltered)", () => {
    expect(PRESETS.conditions.filterOverrides).toBeUndefined();
  });
});

describe("preset filterOverrides", () => {
  it("DUI preset has alcohol filterOverrides", () => {
    expect(PRESETS.dui.filterOverrides).toBeDefined();
    expect(PRESETS.dui.filterOverrides?.alcohol).toBe(true);
  });

  it("presets without filterOverrides have undefined filterOverrides", () => {
    expect(PRESETS.overview.filterOverrides).toBeUndefined();
  });
});

describe("preset slot properties", () => {
  it("all slots have sequential order values starting at 0", () => {
    for (const key of PRESET_KEYS) {
      const charts = buildPresetCharts(key);
      charts.forEach((chart, i) => {
        expect(chart.order).toBe(i);
      });
    }
  });

  it("buildPresetCharts copies all slot fields including options", () => {
    // overview has a trendLine option on the year slot
    const charts = buildPresetCharts("overview");
    const yearChart = charts.find((c) => c.dimension === "year");
    expect(yearChart).toBeDefined();
    expect(yearChart!.options).toEqual({ trendLine: true });
  });

  it("slots without options do not have options field", () => {
    const charts = buildPresetCharts("time");
    const hourChart = charts.find((c) => c.dimension === "hour");
    expect(hourChart).toBeDefined();
    expect(hourChart!.options).toBeUndefined();
  });
});
