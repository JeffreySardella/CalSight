import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatMessage from "./ChatMessage";
import ToastProvider from "../ui/ToastProvider";
import { StoryCanvasProvider } from "../../hooks/useStoryCanvas";
import type { ChatMessage as Msg } from "../../hooks/useAskAi";

const assistantMsg: Msg = {
  role: "assistant", content: "DUI crashes peak at 2am.", timestamp: 100,
  question: "When do DUI crashes peak?", provider: "groq", grounded: true,
};

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

function renderWithProviders(msg: Msg) {
  return render(
    <ToastProvider>
      <StoryCanvasProvider>
        <ChatMessage message={msg} />
      </StoryCanvasProvider>
    </ToastProvider>,
  );
}

describe("ChatMessage copy button", () => {
  it("copies the answer text and confirms with a toast", async () => {
    renderWithProviders(assistantMsg);
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));

    expect(await screen.findByText("Answer copied to clipboard")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("DUI crashes peak at 2am.");
  });

  it("shows an error toast when the clipboard fails", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderWithProviders(assistantMsg);
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));

    expect(await screen.findByText("Couldn't copy to clipboard")).toBeInTheDocument();
  });

  it("does not render a copy button on user messages", () => {
    renderWithProviders({ role: "user", content: "hi", timestamp: 1 });
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });
});
