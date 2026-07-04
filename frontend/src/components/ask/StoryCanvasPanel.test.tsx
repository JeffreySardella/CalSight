import { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import StoryCanvasPanel from "./StoryCanvasPanel";
import { StoryCanvasProvider, useStoryCanvas } from "../../hooks/useStoryCanvas";
import type { ChatMessage } from "../../hooks/useAskAi";

function answer(ts: number, content: string): ChatMessage {
  return { role: "assistant", content, timestamp: ts, question: "Q?", provider: "groq", grounded: true };
}

// Seed the canvas, then render the panel inside the same provider.
function Harness({ open, onClose, exportError }: { open: boolean; onClose: () => void; exportError?: string | null }) {
  const { pinAnswer, count } = useStoryCanvas();
  return (
    <>
      <button onClick={() => pinAnswer(answer(Date.now() + count, `answer ${count + 1}`))}>seed</button>
      <StoryCanvasPanel open={open} onClose={onClose} onExportPng={() => {}} onExportPdf={() => {}} exportError={exportError} />
    </>
  );
}

const wrap = (ui: ReactNode) => render(<StoryCanvasProvider>{ui}</StoryCanvasProvider>);

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
});

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

  it("disables move buttons at the ends", () => {
    wrap(<Harness open onClose={() => {}} />);
    act(() => {
      fireEvent.click(screen.getByText("seed"));
    });
    act(() => {
      fireEvent.click(screen.getByText("seed"));
    });
    const moveUpButtons = screen.getAllByRole("button", { name: /move up/i });
    const moveDownButtons = screen.getAllByRole("button", { name: /move down/i });

    // Ensure we have the expected number of buttons
    expect(moveUpButtons).toHaveLength(2);
    expect(moveDownButtons).toHaveLength(2);

    // First block's move up should be disabled
    expect(moveUpButtons[0]).toBeDisabled();
    // Second block's move up should be enabled
    expect(moveUpButtons[1]).not.toBeDisabled();
    // First block's move down should be enabled
    expect(moveDownButtons[0]).not.toBeDisabled();
    // Last block's move down should be disabled
    expect(moveDownButtons[1]).toBeDisabled();
  });

  it("removes a block when Remove block is clicked", () => {
    wrap(<Harness open onClose={() => {}} />);
    act(() => {
      fireEvent.click(screen.getByText("seed"));
    });
    // Answer content should be visible
    expect(screen.getByText(/answer 1/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove block/i }));
    // Empty state should appear
    expect(screen.getByText(/pin answers from the chat/i)).toBeTruthy();
  });

  it("export buttons are disabled when empty and call spies when populated", () => {
    const onExportPng = vi.fn();
    const onExportPdf = vi.fn();

    function HarnessWithSpies({ open, onClose }: { open: boolean; onClose: () => void }) {
      const { pinAnswer, count } = useStoryCanvas();
      return (
        <>
          <button onClick={() => pinAnswer(answer(Date.now() + count, `answer ${count + 1}`))}>seed</button>
          <StoryCanvasPanel open={open} onClose={onClose} onExportPng={onExportPng} onExportPdf={onExportPdf} />
        </>
      );
    }

    wrap(<HarnessWithSpies open onClose={() => {}} />);

    // Export buttons should be disabled when empty
    const exportPng = screen.getByRole("button", { name: /export png/i });
    const exportPdf = screen.getByRole("button", { name: /export pdf/i });
    expect(exportPng).toBeDisabled();
    expect(exportPdf).toBeDisabled();

    // Seed a block
    act(() => {
      fireEvent.click(screen.getByText("seed"));
    });

    // Buttons should now be enabled
    expect(exportPng).not.toBeDisabled();
    expect(exportPdf).not.toBeDisabled();

    // Click export buttons
    fireEvent.click(exportPng);
    fireEvent.click(exportPdf);

    // Assert the spies were called once
    expect(onExportPng).toHaveBeenCalledTimes(1);
    expect(onExportPdf).toHaveBeenCalledTimes(1);
  });

  describe("export error display", () => {
    it("shows the export error message when exportError prop is set", () => {
      wrap(<Harness open onClose={() => {}} exportError="Export failed. Please try again." />);
      expect(screen.getByText("Export failed. Please try again.")).toBeTruthy();
    });

    it("does not show an export error message when exportError is null", () => {
      wrap(<Harness open onClose={() => {}} exportError={null} />);
      expect(screen.queryByText("Export failed. Please try again.")).toBeNull();
    });

    it("does not show an export error message when exportError is absent", () => {
      wrap(<Harness open onClose={() => {}} />);
      expect(screen.queryByText("Export failed. Please try again.")).toBeNull();
    });
  });

  describe("focus trap", () => {
    it("wraps Tab from the last focusable back to the first", () => {
      wrap(<Harness open onClose={() => {}} />);
      const dialog = screen.getByRole("dialog");
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      );
      expect(focusables.length).toBeGreaterThan(1);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      act(() => { last.focus(); });
      fireEvent.keyDown(dialog, { key: "Tab" });

      expect(document.activeElement).toBe(first);
    });
  });

  describe("focus return on close", () => {
    it("returns focus to the trigger element when the panel is closed", () => {
      function FocusHarness() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button data-testid="trigger" onClick={() => setOpen(true)}>Open</button>
            <StoryCanvasPanel
              open={open}
              onClose={() => setOpen(false)}
              onExportPng={() => {}}
              onExportPdf={() => {}}
            />
          </>
        );
      }

      render(
        <StoryCanvasProvider>
          <FocusHarness />
        </StoryCanvasProvider>
      );

      const trigger = screen.getByTestId("trigger");
      act(() => { trigger.focus(); });
      expect(document.activeElement).toBe(trigger);

      // Open the panel
      act(() => { fireEvent.click(trigger); });
      expect(screen.getByRole("dialog")).toBeTruthy();

      // Close via Escape
      act(() => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
      expect(screen.queryByRole("dialog")).toBeNull();

      expect(document.activeElement).toBe(trigger);
    });
  });
});
