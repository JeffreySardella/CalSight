import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useAskAi", () => ({
  useAskAi: () => ({ sendMessage: vi.fn(), isLoading: false, error: null, retry: vi.fn(), messages: [] }),
}));
vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({ data: undefined, isLoading: false }),
}));

import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const baseFilters = {
  years: [2023], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = {
  kind: "stat", label: "Total crashes statewide", measure: "crash_count", value: 100, filters: baseFilters,
};

function Trigger() {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>open</button>;
}

describe("AiCompanion focus management", () => {
  it("moves focus into the dialog on open and restores it to the trigger on close", () => {
    render(
      <MemoryRouter><AiCompanionProvider><Trigger /></AiCompanionProvider></MemoryRouter>,
    );
    const trigger = screen.getByText("open");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});
