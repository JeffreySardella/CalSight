import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
