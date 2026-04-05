import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KeyboardHelpModal from "./KeyboardHelpModal";

describe("KeyboardHelpModal", () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onClose = vi.fn<() => void>();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <KeyboardHelpModal isOpen={false} onClose={onClose} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders all 7 shortcuts when open", () => {
    const { container } = render(<KeyboardHelpModal isOpen={true} onClose={onClose} />);
    const kbds = container.querySelectorAll("kbd");
    expect(kbds).toHaveLength(7);
  });

  it("has correct ARIA attributes", () => {
    render(<KeyboardHelpModal isOpen={true} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Keyboard shortcuts");
  });

  it("calls onClose when Escape is pressed", async () => {
    render(<KeyboardHelpModal isOpen={true} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when ? is pressed", () => {
    render(<KeyboardHelpModal isOpen={true} onClose={onClose} />);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", bubbles: true })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop is clicked", async () => {
    render(<KeyboardHelpModal isOpen={true} onClose={onClose} />);
    const backdrop = document.querySelector(".backdrop-blur-sm");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it("moves focus to modal on open and restores on close", () => {
    const button = document.createElement("button");
    button.textContent = "Trigger";
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    const { rerender } = render(
      <KeyboardHelpModal isOpen={true} onClose={onClose} />
    );
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);

    rerender(<KeyboardHelpModal isOpen={false} onClose={onClose} />);
    expect(document.activeElement).toBe(button);

    document.body.removeChild(button);
  });
});
