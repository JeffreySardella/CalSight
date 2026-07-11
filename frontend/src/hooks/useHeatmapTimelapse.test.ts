import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHeatmapTimelapse, MS_PER_YEAR_BASE } from "./useHeatmapTimelapse";

// Deterministic rAF: capture callbacks and fire them manually with explicit
// timestamps so year advancement is driven by us, not the clock.
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId: number;
let rafSpy: ReturnType<typeof vi.fn>;
let cafSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rafCallbacks = new Map();
  nextRafId = 0;
  rafSpy = vi.fn((cb: FrameRequestCallback) => {
    rafCallbacks.set(++nextRafId, cb);
    return nextRafId;
  });
  cafSpy = vi.fn((id: number) => {
    rafCallbacks.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", rafSpy);
  vi.stubGlobal("cancelAnimationFrame", cafSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fire all currently pending rAF callbacks with the given timestamp. */
function fireFrame(timestamp: number) {
  const pending = [...rafCallbacks.values()];
  rafCallbacks.clear();
  act(() => {
    pending.forEach((cb) => cb(timestamp));
  });
}

const OPTS = { minYear: 2001, maxYear: 2005 };

describe("useHeatmapTimelapse", () => {
  it("starts inactive at minYear and not playing", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));
    expect(result.current.active).toBe(false);
    expect(result.current.currentYear).toBe(2001);
    expect(result.current.isPlaying).toBe(false);
  });

  it("play activates and advances one year per MS_PER_YEAR_BASE at 1x", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.play());
    expect(result.current.active).toBe(true);
    expect(result.current.isPlaying).toBe(true);

    fireFrame(1_000); // establishes the frame clock; no time elapsed yet
    expect(result.current.currentYear).toBe(2001);

    fireFrame(1_000 + MS_PER_YEAR_BASE); // exactly one year's worth of time
    expect(result.current.currentYear).toBe(2002);

    fireFrame(1_000 + 2 * MS_PER_YEAR_BASE);
    expect(result.current.currentYear).toBe(2003);
  });

  it("guards against double play — a second play() never schedules a second rAF loop", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.play());
    expect(rafSpy).toHaveBeenCalledTimes(1);

    act(() => result.current.play()); // must be a no-op while a loop is live
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // After a frame the loop reschedules itself exactly once — still one loop.
    fireFrame(500);
    expect(rafCallbacks.size).toBe(1);
  });

  it("pause cancels the frame loop and halts advancement", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.play());
    fireFrame(1_000);
    act(() => result.current.pause());

    expect(result.current.isPlaying).toBe(false);
    expect(cafSpy).toHaveBeenCalled();
    // No pending callbacks remain, so no further frames can advance the year.
    expect(rafCallbacks.size).toBe(0);
    // Pausing keeps the timelapse engaged (frame stays visible / scrubable).
    expect(result.current.active).toBe(true);
  });

  it("respects speed: 0.5x needs twice the elapsed time per year", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.setSpeed(0.5));
    act(() => result.current.play());

    // Nonzero start: t=0 would collide with the hook's "clock not started"
    // sentinel (same convention as useTimelapsePlayer).
    fireFrame(1_000);
    fireFrame(1_000 + MS_PER_YEAR_BASE); // only half a (0.5x) year elapsed
    expect(result.current.currentYear).toBe(2001);

    fireFrame(1_000 + 2 * MS_PER_YEAR_BASE);
    expect(result.current.currentYear).toBe(2002);
  });

  it("stops playing at maxYear but stays active on the final frame", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.play());
    fireFrame(1_000);
    fireFrame(1_000 + 100 * MS_PER_YEAR_BASE); // way past the end

    expect(result.current.currentYear).toBe(2005);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.active).toBe(true);
    expect(rafCallbacks.size).toBe(0);
  });

  it("replays from minYear when play() is pressed at the end", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.seek(2005));
    act(() => result.current.play());
    expect(result.current.currentYear).toBe(2001);
    expect(result.current.isPlaying).toBe(true);
  });

  it("seek clamps into range and engages the timelapse", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.seek(2003));
    expect(result.current.currentYear).toBe(2003);
    expect(result.current.active).toBe(true);

    act(() => result.current.seek(1990));
    expect(result.current.currentYear).toBe(2001);
    act(() => result.current.seek(2099));
    expect(result.current.currentYear).toBe(2005);
  });

  it("stop deactivates, halts playback, and resets to minYear", () => {
    const { result } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.play());
    fireFrame(1_000);
    fireFrame(1_000 + MS_PER_YEAR_BASE);
    expect(result.current.currentYear).toBe(2002);

    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.currentYear).toBe(2001);
    expect(rafCallbacks.size).toBe(0);
  });

  it("prefetches the next 2 frames when the playhead moves while active", () => {
    const onPrefetch = vi.fn();
    const { result } = renderHook(() => useHeatmapTimelapse({ ...OPTS, onPrefetch }));

    // Inactive: no prefetching.
    expect(onPrefetch).not.toHaveBeenCalled();

    act(() => result.current.play());
    expect(onPrefetch).toHaveBeenLastCalledWith([2002, 2003]);

    fireFrame(1_000);
    fireFrame(1_000 + MS_PER_YEAR_BASE); // → 2002
    expect(onPrefetch).toHaveBeenLastCalledWith([2003, 2004]);
  });

  it("clamps prefetch to maxYear and skips it entirely on the final frame", () => {
    const onPrefetch = vi.fn();
    const { result } = renderHook(() => useHeatmapTimelapse({ ...OPTS, onPrefetch }));

    act(() => result.current.seek(2004)); // one year left
    expect(onPrefetch).toHaveBeenLastCalledWith([2005]);

    onPrefetch.mockClear();
    act(() => result.current.seek(2005)); // nothing ahead
    expect(onPrefetch).not.toHaveBeenCalled();
  });

  it("reduced motion: play engages the timelapse but never auto-advances", () => {
    const { result } = renderHook(() => useHeatmapTimelapse({ ...OPTS, reducedMotion: true }));

    act(() => result.current.play());
    expect(result.current.active).toBe(true);
    expect(result.current.isPlaying).toBe(false);
    expect(rafSpy).not.toHaveBeenCalled();

    // The scrubber still works manually.
    act(() => result.current.seek(2004));
    expect(result.current.currentYear).toBe(2004);
  });

  it("cancels the frame loop on unmount", () => {
    const { result, unmount } = renderHook(() => useHeatmapTimelapse(OPTS));

    act(() => result.current.play());
    expect(rafCallbacks.size).toBe(1);

    unmount();
    expect(cafSpy).toHaveBeenCalled();
    expect(rafCallbacks.size).toBe(0);
  });
});
