import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InsightBanner from "./InsightBanner";

describe("InsightBanner year-over-year slide", () => {
  it("names the years each change compares", () => {
    render(
      <InsightBanner
        loading={false}
        heroMetrics={{
          incidentYoYPct: -3.3, incidentYoYYears: [2024, 2025],
          yoyFatalityChangePct: -0.3, fatalityYoYYears: [2023, 2024],
        }}
      />,
    );
    expect(screen.getByText(
      "Crashes were down 3.3% in 2025 vs 2024 — deaths were down 0.3% in 2024 vs 2023",
    )).toBeInTheDocument();
  });
});
