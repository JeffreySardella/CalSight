import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

// Spy on the hook that owns the only network path. The hybrid free-tier
// invariant is: opening the instant tier must NEVER hit the API — only the
// explicit "Go deeper" click may. If this ever regresses, every dialog open
// would silently fire a Groq request and blow the free tier.
const sendMessage = vi.fn();
vi.mock("../../hooks/useAskAi", () => ({
  useAskAi: () => ({ sendMessage, isLoading: false, error: null, retry: vi.fn(), messages: [] }),
}));

const filters = {
  years: [2023], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function Trigger() {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>explain</button>;
}

describe("AiCompanion hybrid-tier invariant", () => {
  beforeEach(() => sendMessage.mockClear());

  it("does NOT call the API when the instant tier opens", () => {
    render(<MemoryRouter><AiCompanionProvider><Trigger /></AiCompanionProvider></MemoryRouter>);
    fireEvent.click(screen.getByText("explain"));
    // Dialog is up (instant tier rendered locally)...
    expect(screen.getByRole("dialog", { name: "AI explanation" })).toBeTruthy();
    // ...but nothing touched the network.
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("calls the API exactly once, only on the explicit Go deeper click", () => {
    render(<MemoryRouter><AiCompanionProvider><Trigger /></AiCompanionProvider></MemoryRouter>);
    fireEvent.click(screen.getByText("explain"));
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Go deeper with AI"));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining("Crashes by hour"));
  });
});
