import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({ data: undefined, isLoading: false }),
}));
import { MemoryRouter } from "react-router-dom";
import { AiCompanionProvider } from "./AiCompanion";
import { AskAiProvider } from "../../hooks/useAskAi";
import { Explainable } from "./Explainable";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function setup() {
  render(
    <MemoryRouter>
      <AskAiProvider>
        <AiCompanionProvider>
          <Explainable context={ctx}><span>9</span></Explainable>
        </AiCompanionProvider>
      </AskAiProvider>
    </MemoryRouter>,
  );
}

describe("Explainable", () => {
  it("exposes an accessible explain button", () => {
    setup();
    expect(screen.getByRole("button", { name: "Explain: Crashes by hour" })).toBeTruthy();
  });

  it("opens the companion on Enter", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Explain: Crashes by hour" }), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "AI explanation" })).toBeTruthy();
  });
});
