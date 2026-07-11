import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemporalScrubber from "./TemporalScrubber";

function makeProps(overrides: Partial<Parameters<typeof TemporalScrubber>[0]> = {}) {
  return {
    active: false,
    currentYear: 2010,
    isPlaying: false,
    speed: 1 as const,
    minYear: 2001,
    maxYear: 2025,
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSeek: vi.fn(),
    onSetSpeed: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

describe("TemporalScrubber", () => {
  it("renders a labeled year slider with the correct range", () => {
    render(<TemporalScrubber {...makeProps()} />);
    const slider = screen.getByRole("slider", { name: "Timelapse year" });
    expect(slider).toHaveAttribute("min", "2001");
    expect(slider).toHaveAttribute("max", "2025");
    expect(slider).toHaveValue("2010");
  });

  it("fires onSeek when the slider value changes (keyboard/drag)", () => {
    const props = makeProps();
    render(<TemporalScrubber {...props} />);
    const slider = screen.getByRole("slider", { name: "Timelapse year" });
    fireEvent.change(slider, { target: { value: "2015" } });
    expect(props.onSeek).toHaveBeenCalledWith(2015);
  });

  it("play button is a real button with aria-pressed reflecting playback state", () => {
    const props = makeProps();
    const { rerender } = render(<TemporalScrubber {...props} />);

    const play = screen.getByRole("button", { name: "Play timelapse" });
    expect(play).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(play);
    expect(props.onPlay).toHaveBeenCalledTimes(1);

    rerender(<TemporalScrubber {...props} isPlaying />);
    const pause = screen.getByRole("button", { name: "Pause timelapse" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);
    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it("shows the year badge with a polite live region only while active", () => {
    const props = makeProps();
    const { rerender } = render(<TemporalScrubber {...props} />);
    expect(screen.queryByTestId("temporal-year-badge")).not.toBeInTheDocument();

    rerender(<TemporalScrubber {...props} active currentYear={2012} />);
    const badge = screen.getByTestId("temporal-year-badge");
    expect(badge).toHaveAttribute("aria-live", "polite");
    expect(badge).toHaveTextContent("2012");
    expect(badge).toHaveTextContent("Showing crashes for 2012");
  });

  it("offers speed selection as a radiogroup and reports the chosen speed", () => {
    const props = makeProps();
    render(<TemporalScrubber {...props} />);
    const group = screen.getByRole("radiogroup", { name: "Playback speed" });
    expect(group).toBeInTheDocument();
    const current = screen.getByRole("radio", { name: "1x" });
    expect(current).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "0.5x" }));
    expect(props.onSetSpeed).toHaveBeenCalledWith(0.5);
  });

  it("disables auto-play under reduced motion while the slider stays usable", () => {
    const props = makeProps({ reducedMotion: true });
    render(<TemporalScrubber {...props} />);
    const play = screen.getByRole("button", {
      name: "Auto-play disabled by reduced motion preference",
    });
    expect(play).toBeDisabled();

    const slider = screen.getByRole("slider", { name: "Timelapse year" });
    expect(slider).toBeEnabled();
    fireEvent.change(slider, { target: { value: "2008" } });
    expect(props.onSeek).toHaveBeenCalledWith(2008);
  });

  it("exposes an exit control while active that stops the timelapse", () => {
    const props = makeProps();
    const { rerender } = render(<TemporalScrubber {...props} />);
    expect(screen.queryByRole("button", { name: "Exit timelapse" })).not.toBeInTheDocument();

    rerender(<TemporalScrubber {...props} active />);
    fireEvent.click(screen.getByRole("button", { name: "Exit timelapse" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });
});
