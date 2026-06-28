// frontend/src/components/ai/AiCompanion.inline.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({ data: undefined, isLoading: false }),
}));

const hoisted = vi.hoisted(() => ({
  state: {
    sendMessage: vi.fn(),
    retry: vi.fn(),
    isLoading: false,
    error: null as string | null,
    messages: [] as Array<{ role: string; content: string; timestamp: number; chart?: unknown }>,
  },
}));
vi.mock("../../hooks/useAskAi", () => ({ useAskAi: () => hoisted.state }));

import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

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
function renderApp() {
  return render(<MemoryRouter><AiCompanionProvider><Trigger /></AiCompanionProvider></MemoryRouter>);
}

beforeEach(() => {
  hoisted.state.sendMessage = vi.fn();
  hoisted.state.retry = vi.fn();
  hoisted.state.isLoading = false;
  hoisted.state.error = null;
  hoisted.state.messages = [];
});

describe("AiCompanion inline deep-dive", () => {
  it("does not show any prior assistant answer before Go deeper is clicked", () => {
    hoisted.state.messages = [{ role: "assistant", content: "STALE ANSWER", timestamp: 1 }];
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    expect(screen.queryByText("STALE ANSWER")).toBeNull();
  });

  it("renders the latest assistant answer after Go deeper", () => {
    hoisted.state.messages = [
      { role: "user", content: "q", timestamp: 1 },
      { role: "assistant", content: "Fresh inline answer.", timestamp: 2 },
    ];
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    fireEvent.click(screen.getByText("Go deeper with AI"));
    expect(screen.getByText("Fresh inline answer.")).toBeTruthy();
  });

  it("shows a thinking state while loading after Go deeper", () => {
    hoisted.state.isLoading = true;
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    fireEvent.click(screen.getByText(/Thinking|Go deeper/));
    expect(screen.getByText(/Thinking/)).toBeTruthy();
  });

  it("shows an error with a retry button after Go deeper", () => {
    hoisted.state.error = "Rate limited.";
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    fireEvent.click(screen.getByText("Go deeper with AI"));
    expect(screen.getByText("Rate limited.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(hoisted.state.retry).toHaveBeenCalled();
  });
});
