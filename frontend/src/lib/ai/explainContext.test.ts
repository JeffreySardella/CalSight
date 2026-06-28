import { describe, it, expect } from "vitest";
import { explainContext } from "./explainContext";
import type { DataContext } from "./dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("explainContext", () => {
  it("explains a stat using the distribution", () => {
    const ctx: DataContext = { kind: "stat", label: "Fatality rate", measure: "fatality_rate", value: 1, geography: { type: "county", id: "a", name: "A" }, filters };
    const out = explainContext(ctx, { distribution: [
      { id: "a", name: "A", value: 1 }, { id: "b", name: "B", value: 5 },
    ]});
    expect(out.body).toContain("safer than");
  });

  it("explains a chart by naming its peak", () => {
    const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "8am", value: 3 }, { label: "5pm", value: 9 }], filters };
    const out = explainContext(ctx);
    expect(out.body).toContain("5pm");
  });

  it("falls back to label for unknown kinds", () => {
    const ctx: DataContext = { kind: "county", label: "Kern County", filters };
    const out = explainContext(ctx);
    expect(out.headline).toContain("Kern County");
  });
});
