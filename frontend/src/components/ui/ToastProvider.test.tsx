import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ToastProvider from "./ToastProvider";
import { useToast, type ToastOptions } from "./toastContext";

let counter = 0;

function Fire({ message, options, label = "fire" }: { message?: string; options?: ToastOptions; label?: string }) {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast(message ?? `toast-${++counter}`, options)}>
      {label}
    </button>
  );
}

function renderHarness(props: { message?: string; options?: ToastOptions } = {}) {
  return render(
    <ToastProvider>
      <Fire {...props} />
    </ToastProvider>,
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    counter = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders toasts inside a polite aria-live region", () => {
    renderHarness({ message: "Saved!" });
    const region = screen.getByTestId("toast-viewport");
    expect(region).toHaveAttribute("aria-live", "polite");

    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved!");
  });

  it("auto-dismisses after the default duration", () => {
    renderHarness({ message: "Bye soon" });
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(screen.getByText("Bye soon")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByText("Bye soon")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Bye soon")).toBeNull();
  });

  it("respects a custom duration", () => {
    renderHarness({ message: "Quick", options: { duration: 1000 } });
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText("Quick")).toBeNull();
  });

  it("pauses auto-dismiss while hovered and resumes on leave", () => {
    renderHarness({ message: "Hover me" });
    fireEvent.click(screen.getByRole("button", { name: "fire" }));

    act(() => vi.advanceTimersByTime(1000));
    fireEvent.mouseEnter(screen.getByTestId("toast-viewport"));
    // Way past the normal 4s lifetime — still visible while hovered.
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Hover me")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId("toast-viewport"));
    // Remaining time (~3s) elapses after un-hover.
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText("Hover me")).toBeNull();
  });

  it("stacks at most 3 toasts, dropping the oldest", () => {
    renderHarness();
    const btn = screen.getByRole("button", { name: "fire" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(screen.queryByText("toast-1")).toBeNull();
    expect(screen.getByText("toast-2")).toBeInTheDocument();
    expect(screen.getByText("toast-3")).toBeInTheDocument();
    expect(screen.getByText("toast-4")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
  });

  it("dismisses on the close button", () => {
    renderHarness({ message: "Dismiss me" });
    fireEvent.click(screen.getByRole("button", { name: "fire" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Dismiss me")).toBeNull();
  });

  it("useToast is a safe no-op without a provider", () => {
    render(<Fire message="orphan" />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "fire" }))).not.toThrow();
    expect(screen.queryByText("orphan")).toBeNull();
  });
});
