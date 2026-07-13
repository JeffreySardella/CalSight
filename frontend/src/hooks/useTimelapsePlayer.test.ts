import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimelapsePlayer } from "./useTimelapsePlayer";

// Deterministic rAF: capture callbacks and fire them manually so we can assert
// exactly how many loops are scheduled. (Same harness as useHeatmapTimelapse.)
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

describe("useTimelapsePlayer", () => {
  it("starts at minYear and not playing", () => {
    const { result } = renderHook(() => useTimelapsePlayer(2001, 2005));
    expect(result.current.currentYear).toBe(2001);
    expect(result.current.isPlaying).toBe(false);
  });

  it("play schedules exactly one rAF loop", () => {
    const { result } = renderHook(() => useTimelapsePlayer(2001, 2005));
    act(() => result.current.play());
    expect(result.current.isPlaying).toBe(true);
    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it("guards against double play — a second play() never schedules a second rAF loop", () => {
    const { result } = renderHook(() => useTimelapsePlayer(2001, 2005));

    act(() => result.current.play());
    expect(rafSpy).toHaveBeenCalledTimes(1);

    act(() => result.current.play()); // must be a no-op while a loop is live
    expect(rafSpy).toHaveBeenCalledTimes(1);

    // After a frame the loop reschedules itself exactly once — still one loop.
    fireFrame(500);
    expect(rafCallbacks.size).toBe(1);
  });

  it("pause cancels the loop and play can resume a single loop", () => {
    const { result } = renderHook(() => useTimelapsePlayer(2001, 2005));

    act(() => result.current.play());
    act(() => result.current.pause());
    expect(result.current.isPlaying).toBe(false);
    expect(rafCallbacks.size).toBe(0);

    act(() => result.current.play());
    expect(rafSpy).toHaveBeenCalledTimes(2);
    expect(rafCallbacks.size).toBe(1);
  });
});
