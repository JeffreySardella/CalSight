import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHeatmapSuppression } from "./useHeatmapSuppression";

interface RenderArgs {
  selectedCountiesSize: number;
  heatmapRequested: boolean;
}

function renderTarget(initial: RenderArgs) {
  return renderHook<ReturnType<typeof useHeatmapSuppression>, RenderArgs>(
    (props) => useHeatmapSuppression(props),
    { initialProps: initial },
  );
}

describe("useHeatmapSuppression", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not suppress below 3 counties", () => {
    const { result } = renderTarget({ selectedCountiesSize: 2, heatmapRequested: true });
    expect(result.current.suppressed).toBe(false);
    expect(result.current.noteVisible).toBe(false);
  });

  it("suppresses and announces when the selection reaches 3", () => {
    const { result, rerender } = renderTarget({ selectedCountiesSize: 2, heatmapRequested: true });

    act(() => rerender({ selectedCountiesSize: 3, heatmapRequested: true }));

    expect(result.current.suppressed).toBe(true);
    expect(result.current.noteVisible).toBe(true);
  });

  it("lifts suppression by itself when the selection narrows again", () => {
    // The bug this replaces: the old hook switched the layer toggles off, and
    // those are persisted — so the heatmap stayed dark long after the wide
    // selection was gone, including across reloads.
    const { result, rerender } = renderTarget({ selectedCountiesSize: 4, heatmapRequested: true });
    expect(result.current.suppressed).toBe(true);

    act(() => rerender({ selectedCountiesSize: 1, heatmapRequested: true }));

    expect(result.current.suppressed).toBe(false);
    expect(result.current.noteVisible).toBe(false);
  });

  it("stays quiet when no heatmap layer is switched on", () => {
    const { result } = renderTarget({ selectedCountiesSize: 4, heatmapRequested: false });
    expect(result.current.suppressed).toBe(true);
    expect(result.current.noteVisible).toBe(false);
  });

  it("announces once per episode, not on every render", () => {
    const { result, rerender } = renderTarget({ selectedCountiesSize: 3, heatmapRequested: true });
    expect(result.current.noteVisible).toBe(true);

    act(() => result.current.dismissNote());
    act(() => rerender({ selectedCountiesSize: 4, heatmapRequested: true }));
    expect(result.current.noteVisible).toBe(false);

    // A fresh episode announces again.
    act(() => rerender({ selectedCountiesSize: 1, heatmapRequested: true }));
    act(() => rerender({ selectedCountiesSize: 3, heatmapRequested: true }));
    expect(result.current.noteVisible).toBe(true);
  });

  it("auto-dismisses the note after 5 seconds", () => {
    const { result } = renderTarget({ selectedCountiesSize: 3, heatmapRequested: true });
    expect(result.current.noteVisible).toBe(true);

    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.noteVisible).toBe(false);
  });

  it("dismissNote() hides the note immediately", () => {
    const { result } = renderTarget({ selectedCountiesSize: 3, heatmapRequested: true });
    expect(result.current.noteVisible).toBe(true);

    act(() => result.current.dismissNote());
    expect(result.current.noteVisible).toBe(false);
  });
});
