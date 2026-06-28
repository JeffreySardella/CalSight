import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import StoryCanvasPanel from "./StoryCanvasPanel";
import { StoryCanvasProvider, useStoryCanvas } from "../../hooks/useStoryCanvas";
import type { ChatMessage } from "../../hooks/useAskAi";

function answer(ts: number, content: string): ChatMessage {
  return { role: "assistant", content, timestamp: ts, question: "Q?", provider: "groq", grounded: true };
}

// Seed the canvas, then render the panel inside the same provider.
function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pinAnswer, count } = useStoryCanvas();
  return (
    <>
      <button onClick={() => pinAnswer(answer(Date.now() + count, `answer ${count + 1}`))}>seed</button>
      <StoryCanvasPanel open={open} onClose={onClose} onExportPng={() => {}} onExportPdf={() => {}} />
    </>
  );
}

const wrap = (ui: ReactNode) => render(<StoryCanvasProvider>{ui}</StoryCanvasProvider>);

beforeEach(() => sessionStorage.clear());

describe("StoryCanvasPanel", () => {
  it("renders nothing when closed", () => {
    wrap(<Harness open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an empty state when there are no blocks", () => {
    wrap(<Harness open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /story/i })).toBeTruthy();
    expect(screen.getByText(/pin answers from the chat/i)).toBeTruthy();
  });

  it("adds a note block from the panel", () => {
    wrap(<Harness open onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    expect(screen.getByPlaceholderText(/note/i)).toBeTruthy();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    wrap(<Harness open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the canvas after confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    wrap(<Harness open onClose={() => {}} />);
    act(() => { fireEvent.click(screen.getByText("seed")); });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByText(/pin answers from the chat/i)).toBeTruthy();
    vi.restoreAllMocks();
  });
});
