import { describe, it, expect } from "vitest";
import { generateDashboardNarrative } from "./narrativeEngine";
import type { Anomaly } from "./anomaly";

describe("narrativeEngine", () => {
  it("anomaly confidence displays as percentage without double-multiplication", () => {
    const anomalies: Anomaly[] = [{
      id: "test-1",
      method: "zscore",
      severity: "critical",
      confidence: 95,
      message: "test anomaly",
      dimension: "hour",
      measure: "count",
      index: 0,
      label: "2 AM",
      value: 500,
    }];

    const result = generateDashboardNarrative(
      { "hour:count": [{ label: "1 AM", value: 100 }, { label: "2 AM", value: 500 }, { label: "3 AM", value: 120 }] },
      [{ id: "chart1", dimension: "hour", measure: "count" }],
      anomalies,
      { counties: [], severities: [], causes: [], flags: [] },
      "technical",
    );

    const anomalyFinding = result.keyFindings.find(f => f.text.includes("confidence"));
    expect(anomalyFinding).toBeDefined();
    expect(anomalyFinding!.text).toContain("95%");
    expect(anomalyFinding!.text).not.toContain("9500%");
  });
});
