// frontend/src/components/ai/AiCompanion.distribution.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useAskAi", () => ({
  useAskAi: () => ({ sendMessage: vi.fn(), isLoading: false, error: null, retry: vi.fn(), messages: [] }),
}));
// Always return a 2-county distribution; the provider's gate decides whether to use it.
vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({
    data: [{ id: "kern", name: "Kern", value: 100 }, { id: "x", name: "X", value: 500 }],
    isLoading: false,
  }),
}));

import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const baseFilters = {
  years: [2023], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

const countyStat: DataContext = {
  kind: "stat", label: "Total crashes · Kern", measure: "crash_count", value: 100,
  geography: { type: "county", id: "kern", name: "Kern" }, filters: baseFilters,
};
const statewideStat: DataContext = {
  kind: "stat", label: "Total crashes statewide", measure: "crash_count", value: 100, filters: baseFilters,
};

function Trigger({ ctx }: { ctx: DataContext }) {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>open</button>;
}
function renderWith(ctx: DataContext) {
  return render(<MemoryRouter><AiCompanionProvider><Trigger ctx={ctx} /></AiCompanionProvider></MemoryRouter>);
}

describe("AiCompanion distribution tier", () => {
  it("renders a percentile narrative for a single-county stat", () => {
    renderWith(countyStat);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog").textContent).toMatch(/ranks #|safer than/i);
  });

  it("does not use distribution for a statewide stat (no county geography)", () => {
    renderWith(statewideStat);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog").textContent).not.toMatch(/ranks #|safer than/i);
  });

  it("does not show percentile when a population-narrowing filter (severity) is active", () => {
    const filteredStat: DataContext = {
      ...countyStat,
      filters: { ...baseFilters, severities: ["Fatal"] },
    };
    renderWith(filteredStat);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog").textContent).not.toMatch(/ranks #|safer than/i);
  });

  it("does not show percentile when two years are selected", () => {
    const multiYearStat: DataContext = {
      ...countyStat,
      filters: { ...baseFilters, years: [2022, 2023] },
    };
    renderWith(multiYearStat);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog").textContent).not.toMatch(/ranks #|safer than/i);
  });
});
