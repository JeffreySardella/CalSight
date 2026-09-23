import { describe, it, expect } from "vitest";
import { detectAllAnomalies } from "./anomaly";

describe("detectAllAnomalies", () => {
  const makeData = (values: number[]) =>
    values.map((v, i) => ({ label: `item-${i}`, value: v }));

  it("matches data to charts by key, not position", () => {
    const dataBySlot: Record<string, { label: string; value: number }[]> = {
      "cause:count": makeData([100, 200, 50, 80]),
      "hour:count": makeData([10, 10, 10, 500]),
    };
    const charts = [
      { dimension: "hour" as const, measure: "count" as const, id: "chart-hour" },
      { dimension: "cause" as const, measure: "count" as const, id: "chart-cause" },
    ];

    const result = detectAllAnomalies(dataBySlot, charts);

    if (result.byChart["chart-hour"]?.length) {
      const hourAnomalies = result.byChart["chart-hour"];
      expect(hourAnomalies.every(a => a.dimension === "hour")).toBe(true);
    }
    if (result.byChart["chart-cause"]?.length) {
      const causeAnomalies = result.byChart["chart-cause"];
      expect(causeAnomalies.every(a => a.dimension === "cause")).toBe(true);
    }
  });

  it("skips charts with no matching data", () => {
    const dataBySlot = {
      "hour:count": makeData([10, 10, 10, 500]),
    };
    const charts = [
      { dimension: "hour" as const, measure: "count" as const, id: "chart-hour" },
      { dimension: "cause" as const, measure: "count" as const, id: "chart-cause" },
    ];

    const result = detectAllAnomalies(dataBySlot, charts);
    expect(result.byChart["chart-cause"]).toBeUndefined();
  });

  it("never flags a preliminary deaths year", () => {
    const now = new Date().getFullYear();
    // Steady deaths, then last year's still-lagging count.
    const years = [4000, 4010, 3990, 4005, 3995, 4000, 2000];
    const series = years.map((v, i) => ({ label: String(now - years.length + i), value: v }));
    const charts = [{ dimension: "year" as const, measure: "killed" as const, id: "deaths" }];
    const deaths = detectAllAnomalies({ "year:killed": series }, charts);
    expect(deaths.all.some(a => a.label === String(now - 1))).toBe(false);
    // The same shape in crash counts is still flagged.
    const crashes = detectAllAnomalies(
      { "year:count": series },
      [{ dimension: "year" as const, measure: "count" as const, id: "crashes" }],
    );
    expect(crashes.all.some(a => a.label === String(now - 1))).toBe(true);
  });
});
