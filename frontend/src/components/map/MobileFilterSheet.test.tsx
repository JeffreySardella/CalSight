import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MobileFilterSheet from "./MobileFilterSheet";

describe("MobileFilterSheet", () => {
  let onClose: ReturnType<typeof vi.fn<() => void>>;
  let onClear: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onClose = vi.fn<() => void>();
    onClear = vi.fn<() => void>();
  });

  const tabs = [{ key: "filters" as const, label: "Filters", icon: "filter_list", content: <p>Filter controls</p> }];

  it("calls onClose when Escape is pressed (WCAG 2.1.1)", async () => {
    render(<MobileFilterSheet isOpen={true} onClose={onClose} onClear={onClear} tabs={tabs} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open and restores it to the trigger on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Edit Filters";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <MobileFilterSheet isOpen={true} onClose={onClose} onClear={onClear} tabs={tabs} />
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    rerender(<MobileFilterSheet isOpen={false} onClose={onClose} onClear={onClear} tabs={tabs} />);
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it("traps Tab focus inside the dialog while open", async () => {
    render(<MobileFilterSheet isOpen={true} onClose={onClose} onClear={onClear} tabs={tabs} />);
    const dialog = await screen.findByRole("dialog");

    // Tabbing repeatedly must never land focus outside the dialog.
    for (let i = 0; i < 10; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
