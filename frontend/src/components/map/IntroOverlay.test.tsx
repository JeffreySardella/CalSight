import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import IntroOverlay from "./IntroOverlay";

// The live total is fetched over the network via react-query; irrelevant to
// the onboarding-flow behavior under test here.
vi.mock("../../hooks/useLiveCrashTotal", () => ({
  useLiveCrashTotal: () => 11_600_000,
}));

describe("IntroOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the two mode choices plus a skip option on first visit", () => {
    render(<IntroOverlay onStart={vi.fn()} />);
    expect(screen.getByText("Simple")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText(/skip, just show me the map/i)).toBeInTheDocument();
  });

  it("renders nothing once the intro has already been seen", () => {
    localStorage.setItem("calsight-intro-seen", "1");
    render(<IntroOverlay onStart={vi.fn()} />);
    expect(screen.queryByText(/skip, just show me the map/i)).not.toBeInTheDocument();
  });

  it("skip marks the intro seen and dismisses without opening the filter flow", () => {
    vi.useFakeTimers();
    const onStart = vi.fn();
    render(<IntroOverlay onStart={onStart} />);

    fireEvent.click(screen.getByText(/skip, just show me the map/i));
    vi.advanceTimersByTime(600);

    expect(localStorage.getItem("calsight-intro-seen")).toBe("1");
    // onStart is what MapPage uses to open the filter sheet — skip must not
    // trigger it, that's the whole point of "just show me the map".
    expect(onStart).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("still calls onStart with the chosen mode for Simple/Advanced", () => {
    vi.useFakeTimers();
    const onStart = vi.fn();
    render(<IntroOverlay onStart={onStart} />);

    fireEvent.click(screen.getByText("Simple"));
    vi.advanceTimersByTime(600);

    expect(localStorage.getItem("calsight-intro-seen")).toBe("1");
    expect(onStart).toHaveBeenCalledWith("simple");

    vi.useRealTimers();
  });
});
