import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ChatMessage from "./ChatMessage";
import ToastProvider from "../ui/ToastProvider";
import { StoryCanvasProvider } from "../../hooks/useStoryCanvas";
import type { ChatMessage as Msg } from "../../hooks/useAskAi";

const TABLE = [
  "Top counties:",
  "",
  "| County | Crashes |",
  "| --- | ---: |",
  "| Los Angeles | 3,400,000 |",
  "| San Diego | 900,000 |",
].join("\n");

describe("ChatMessage GitHub-flavored markdown", () => {
  it("renders a pipe table as a real <table> inside a horizontal-scroll wrapper", () => {
    const msg: Msg = { role: "assistant", content: TABLE, timestamp: 1, provider: "groq", grounded: true };
    const { container } = render(
      <ToastProvider>
        <StoryCanvasProvider>
          <ChatMessage message={msg} />
        </StoryCanvasProvider>
      </ToastProvider>,
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.parentElement!.className).toContain("overflow-x-auto");
    expect(table!.querySelectorAll("th")).toHaveLength(2);
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container.textContent).not.toContain("| County |");
  });
});
