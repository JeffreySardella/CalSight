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
});
