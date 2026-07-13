import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConversationExportMenu from "./ConversationExportMenu";
import type { ChatMessage } from "../../hooks/useAskAi";

const messages: ChatMessage[] = [
  { role: "user", content: "hi", timestamp: 1 },
  { role: "assistant", content: "hello", timestamp: 2, provider: "groq" },
];

describe("ConversationExportMenu", () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when there is no conversation", () => {
    const { container } = render(<ConversationExportMenu messages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the menu and exposes both formats with menu semantics", () => {
    render(<ConversationExportMenu messages={messages} />);
    const trigger = screen.getByRole("button", { name: /export conversation/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /json/i })).toBeInTheDocument();
  });

  it("downloads and closes the menu when a format is chosen", () => {
    render(<ConversationExportMenu messages={messages} />);
    fireEvent.click(screen.getByRole("button", { name: /export conversation/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /markdown/i }));
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape without downloading", () => {
    render(<ConversationExportMenu messages={messages} />);
    fireEvent.click(screen.getByRole("button", { name: /export conversation/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled();
  });
});
