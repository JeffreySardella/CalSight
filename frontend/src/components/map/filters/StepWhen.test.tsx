import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StepWhen from "./StepWhen";
import type { StagedFilters } from "../../../hooks/useStagedFilters";

const STAGED: StagedFilters = {
  selectedYears: new Set(),
  dateRange: null,
  severities: new Set(),
  causes: new Set(),
  alcohol: false,
  distracted: false,
  pedestrian: false,
  cyclist: false,
  drug: false,
  driverAge: null,
  weather: new Set(),
  lighting: new Set(),
  collisionType: new Set(),
  roadType: null,
  hitRun: false,
};

describe("StepWhen", () => {
  it("marks the in-progress year's chip as partial", () => {
    const current = new Date().getFullYear();
    render(
      <StepWhen
        staged={STAGED}
        onToggleYear={() => {}}
        onSetAllYears={() => {}}
        yearCounts={{ [current]: 257_000, [current - 1]: 402_000 }}
      />,
    );
    expect(screen.getByRole("button", { name: new RegExp(`^${current} so far`) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`^${current - 1}\\s*\\(402K\\)`) })).toBeInTheDocument();
  });

  it("picking only a year spans January of From to December of To (matches FiltersPanel, #521)", async () => {
    const onSetDateRange = vi.fn();
    render(
      <StepWhen
        staged={STAGED}
        onToggleYear={() => {}}
        onSetAllYears={() => {}}
        onSetDateRange={onSetDateRange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /set specific month range/i }));
    await userEvent.click(screen.getByRole("button", { name: "To year" }));
    // "2020" also labels the (unrelated) year chip above the month-range
    // panel — the dropdown option is the last match in DOM order.
    const options = screen.getAllByRole("button", { name: "2020" });
    await userEvent.click(options[options.length - 1]);
    expect(onSetDateRange).toHaveBeenCalledWith(null, { year: 2020, month: 12 });
  });
});
