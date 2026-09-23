import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AnomalyPanel from "./AnomalyPanel";
import type { Anomaly, AnomalySeverity } from "../../lib/dashboard/anomaly";

const anomaly = (i: number, severity: AnomalySeverity): Anomaly => ({
  id: `a-${i}`, method: "zscore", severity, confidence: 90, message: `m${i}`,
  dimension: "hour", measure: "count", index: i, label: `${i} AM`, value: 1,
});

describe("AnomalyPanel", () => {
  it("heading and badge count the same list", () => {
    // Three significant + one medium: it used to read "3 significant" beside a badge of 4.
    render(<AnomalyPanel defaultCollapsed anomalies={[
      anomaly(0, "critical"), anomaly(1, "high"), anomaly(2, "high"), anomaly(3, "medium"),
    ]} />);
    expect(screen.getByText("4 patterns detected, 3 significant")).toBeInTheDocument();
    expect(screen.getByText("4", { selector: "span" })).toBeInTheDocument();
  });

  it("drops the significant clause when none are", () => {
    render(<AnomalyPanel anomalies={[anomaly(0, "medium")]} />);
    expect(screen.getByText("1 pattern detected")).toBeInTheDocument();
  });
});
