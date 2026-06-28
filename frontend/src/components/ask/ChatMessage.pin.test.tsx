import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatMessage from "./ChatMessage";
import { StoryCanvasProvider } from "../../hooks/useStoryCanvas";
import type { ChatMessage as Msg } from "../../hooks/useAskAi";

const assistantMsg: Msg = {
  role: "assistant", content: "DUI crashes peak at 2am.", timestamp: 100,
  question: "When do DUI crashes peak?", provider: "groq", grounded: true,
};

beforeEach(() => sessionStorage.clear());

function renderWithProvider(msg: Msg) {
  return render(<StoryCanvasProvider><ChatMessage message={msg} /></StoryCanvasProvider>);
}

describe("ChatMessage pin button", () => {
  it("pins the answer and reflects pressed state", () => {
    renderWithProvider(assistantMsg);
    const btn = screen.getByRole("button", { name: "Pin to story" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Pinned to story" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not render a pin button on user messages", () => {
    renderWithProvider({ role: "user", content: "hi", timestamp: 1 });
    expect(screen.queryByRole("button", { name: /pin/i })).toBeNull();
  });
});
