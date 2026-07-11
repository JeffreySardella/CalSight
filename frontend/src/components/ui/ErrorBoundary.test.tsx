import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { queryClient } from "../../lib/queryClient";

// Defined at module level so the reference is stable across rerenders —
// if defined inside a test, React sees a new component type and unmounts/remounts.
let throwOnRender = false;
function Bomb() {
  if (throwOnRender) throw new Error("test error");
  return <span>OK</span>;
}

describe("ErrorBoundary", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    throwOnRender = false;
    reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload: reloadSpy },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when there is no error", () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("shows the default error UI when a child throws", () => {
    throwOnRender = true;
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("renders a custom fallback instead of the default UI", () => {
    throwOnRender = true;
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing when fallback={null} and child throws", () => {
    throwOnRender = true;
    const { container } = render(
      <ErrorBoundary fallback={null}><Bomb /></ErrorBoundary>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("escalates 'Try again' to 'Reload page' after 3 retries", () => {
    throwOnRender = true;
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    const btn = () => screen.getByRole("button");
    expect(btn()).toHaveTextContent("Try again");

    fireEvent.click(btn()); // retryCount → 1, Bomb re-throws
    fireEvent.click(btn()); // retryCount → 2
    fireEvent.click(btn()); // retryCount → 3, exhausted

    expect(btn()).toHaveTextContent("Reload page");
  });

  it("calls window.location.reload when the exhausted button is clicked", () => {
    throwOnRender = true;
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    const btn = () => screen.getByRole("button");
    fireEvent.click(btn()); // 1
    fireEvent.click(btn()); // 2
    fireEvent.click(btn()); // 3 — exhausted, button now "Reload page"
    fireEvent.click(btn()); // triggers reload

    expect(reloadSpy).toHaveBeenCalledOnce();
  });

  it("does not wipe the query cache on retry — M17", () => {
    // Boundaries wrap individual chart cards; a retry must not clear (or
    // otherwise touch) the app-wide query cache.
    const clearSpy = vi.spyOn(queryClient, "clear");
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    throwOnRender = true;
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    throwOnRender = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("resets retry count after a successful recovery", () => {
    throwOnRender = true;
    const { rerender } = render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    const btn = () => screen.getByRole("button");

    // Failed retry — retryCount increments to 1 but Bomb re-throws
    fireEvent.click(btn());
    expect(btn()).toHaveTextContent("Try again");

    // Successful recovery
    throwOnRender = false;
    fireEvent.click(btn());
    expect(screen.getByText("OK")).toBeInTheDocument();

    // New error episode — retryCount should have reset, not accumulated
    throwOnRender = true;
    rerender(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(btn()).toHaveTextContent("Try again");
  });

  it("clears its error when resetKey changes (e.g. route navigation) — M-F12", () => {
    throwOnRender = true;
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Bomb /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Navigate to a different route: child is healthy and resetKey changes.
    throwOnRender = false;
    rerender(<ErrorBoundary resetKey="/b"><Bomb /></ErrorBoundary>);

    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays latched when resetKey is unchanged", () => {
    throwOnRender = true;
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Bomb /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Same route, child now healthy — boundary must NOT auto-clear on its own.
    throwOnRender = false;
    rerender(<ErrorBoundary resetKey="/a"><Bomb /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
