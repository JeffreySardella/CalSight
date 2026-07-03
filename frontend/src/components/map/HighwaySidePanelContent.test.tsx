import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({ data: undefined, isLoading: false }),
}));

import { MemoryRouter } from "react-router-dom";
import { AiCompanionProvider } from "../ai/AiCompanion";
import { AskAiProvider } from "../../hooks/useAskAi";
import HighwaySidePanelContent from "./HighwaySidePanelContent";
import type { HighwayRow } from "../../hooks/useHighwayRankings";
import type { FilterSnapshot } from "../../lib/ai/dataContext";

const baseRow: HighwayRow = {
  route_number: "I-5",
  crash_count: 1234,
  total_killed: 56,
  total_injured: 789,
  fatality_rate: 0.045,
  miles: 796,
  crashes_per_mile: 1.55,
};

const emptyFilters: FilterSnapshot = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

function renderPanel(row: HighwayRow = baseRow) {
  return render(
    <MemoryRouter>
      <AskAiProvider>
        <AiCompanionProvider>
          <HighwaySidePanelContent row={row} filters={emptyFilters} />
        </AiCompanionProvider>
      </AskAiProvider>
    </MemoryRouter>,
  );
}

it("renders the route id and formatted stats", () => {
  renderPanel();
  expect(screen.getByText("I-5")).toBeInTheDocument();
  expect(screen.getByText("1,234")).toBeInTheDocument(); // crash_count
  expect(screen.getByText("56")).toBeInTheDocument(); // total_killed
  expect(screen.getByText("789")).toBeInTheDocument(); // total_injured
  expect(screen.getByText("4.5%")).toBeInTheDocument(); // fatality_rate
  expect(screen.getByText("1.55")).toBeInTheDocument(); // crashes_per_mile
});

it("shows an em dash when crashes_per_mile is null", () => {
  renderPanel({ ...baseRow, crashes_per_mile: null });
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("exposes each stat as an AI explain affordance", () => {
  renderPanel();
  expect(screen.getByRole("button", { name: "Explain: I-5 · crashes" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Explain: I-5 · fatality rate" })).toBeInTheDocument();
});

it("opens the AI companion when a stat is clicked", () => {
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Explain: I-5 · fatality rate" }));
  expect(screen.getByRole("dialog", { name: "AI explanation" })).toBeInTheDocument();
});

it("does not make a null crashes-per-mile value explainable", () => {
  renderPanel({ ...baseRow, crashes_per_mile: null });
  expect(screen.queryByRole("button", { name: "Explain: I-5 · crashes per mile" })).not.toBeInTheDocument();
});
