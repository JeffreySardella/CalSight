import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({ data: undefined, isLoading: false }),
}));
import { MemoryRouter } from "react-router-dom";
import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import { AskAiProvider } from "../../hooks/useAskAi";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function Trigger() {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>explain</button>;
}

describe("AiCompanion", () => {
  it("opens on demand and shows the instant explanation", () => {
    render(<MemoryRouter><AskAiProvider><AiCompanionProvider><Trigger /></AiCompanionProvider></AskAiProvider></MemoryRouter>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("explain"));
    const dialog = screen.getByRole("dialog", { name: "AI explanation" });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Crashes by hour");
  });

  it("closes on Escape", () => {
    render(<MemoryRouter><AskAiProvider><AiCompanionProvider><Trigger /></AiCompanionProvider></AskAiProvider></MemoryRouter>);
    fireEvent.click(screen.getByText("explain"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
