import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { ChatMessage as ChatMessageType } from "../../hooks/useAskAi";

// ChatMessage renders markdown (and possibly a chart) — expensive. The Ask AI
// page re-renders on every keystroke in the textarea; without memo every
// message in the transcript re-renders markdown per keystroke (M-F6).
//
// useStoryCanvas is called once per actual ChatMessage render, so the mock
// doubles as a render counter that sees through React.memo bailouts.
const hoisted = vi.hoisted(() => ({ renders: { count: 0 } }));
vi.mock("../../hooks/useStoryCanvas", () => ({
  useStoryCanvas: () => {
    hoisted.renders.count += 1;
    return { pinAnswer: () => {}, isPinned: () => false };
  },
}));

import ChatMessage from "./ChatMessage";

const message: ChatMessageType = {
  role: "assistant",
  content: "**Hello** — 42 crashes.",
  timestamp: 1710000000000,
  provider: "test",
};

function Harness() {
  const [, setTick] = useState(0);
  return (
    <div>
      <button onClick={() => setTick((t) => t + 1)}>retick</button>
      <ChatMessage message={message} />
    </div>
  );
}

describe("ChatMessage memoization (M-F6)", () => {
  it("does not re-render for unrelated parent re-renders (same message prop)", () => {
    render(<Harness />);
    const initialRenders = hoisted.renders.count;
    expect(initialRenders).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("retick"));
    fireEvent.click(screen.getByText("retick"));
    fireEvent.click(screen.getByText("retick"));

    // A memoized ChatMessage bails out on identical props.
    expect(hoisted.renders.count).toBe(initialRenders);
  });
});
