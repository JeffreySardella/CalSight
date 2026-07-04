import { useRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

function Dialog({ active, onClose }: { active: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onClose);
  if (!active) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button>first</button>
      <button>middle</button>
      <button>last</button>
    </div>
  );
}

beforeEach(() => {
  cleanup();
});

describe("useFocusTrap", () => {
  it("moves focus into the dialog when it activates", () => {
    render(<Dialog active onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("wraps Tab from the last focusable back to the first", () => {
    render(<Dialog active onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    act(() => { screen.getByText("last").focus(); });

    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first focusable back to the last", () => {
    render(<Dialog active onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    act(() => { screen.getByText("first").focus(); });

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<Dialog active onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("restores focus to the element focused before activation", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => { outside.focus(); });

    const { rerender } = render(<Dialog active={false} onClose={() => {}} />);
    rerender(<Dialog active onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    rerender(<Dialog active={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
