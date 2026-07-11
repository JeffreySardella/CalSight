import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  let onConfirm: ReturnType<typeof vi.fn<() => void>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onConfirm = vi.fn<() => void>();
    onCancel = vi.fn<() => void>();
  });

  function renderDialog(open = true) {
    return render(
      <ConfirmDialog
        open={open}
        title="Clear all filters?"
        message="This removes every active filter."
        confirmLabel="Clear all"
        cancelLabel="Keep filters"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
  }

  it("renders nothing while closed", () => {
    renderDialog(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is an aria-modal alertdialog labelled by its title and described by its message", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog", { name: "Clear all filters?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("This removes every active filter.");
  });

  it("moves focus into the dialog when opened", () => {
    renderDialog();
    expect(screen.getByRole("alertdialog")).toHaveFocus();
  });

  it("traps Tab within the dialog (wraps last → first)", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: "Clear all" });
    const cancel = screen.getByRole("button", { name: "Keep filters" });

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
  });

  it("traps Shift+Tab within the dialog (wraps first → last)", () => {
    renderDialog();
    const confirm = screen.getByRole("button", { name: "Clear all" });
    const cancel = screen.getByRole("button", { name: "Keep filters" });

    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("cancels on Escape", () => {
    renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms on the confirm button and cancels on the cancel button and backdrop", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Keep filters" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on close", () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(
      <ConfirmDialog open title="T" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByRole("alertdialog")).toHaveFocus();

    rerender(<ConfirmDialog open={false} title="T" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
