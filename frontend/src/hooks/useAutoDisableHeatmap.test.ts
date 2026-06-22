import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoDisableHeatmap } from "./useAutoDisableHeatmap";

interface RenderArgs {
  selectedCountiesSize: number;
  heatmapCountyOn: boolean;
  heatmapStatewideOn: boolean;
}

function renderTarget(initial: RenderArgs) {
  const setHeatmapCounty = vi.fn<(on: boolean) => void>();
  const setHeatmapStatewide = vi.fn<(on: boolean) => void>();
  const utils = renderHook<
    ReturnType<typeof useAutoDisableHeatmap>,
    RenderArgs
  >(
    ({ selectedCountiesSize, heatmapCountyOn, heatmapStatewideOn }) =>
      useAutoDisableHeatmap({
        selectedCountiesSize,
        heatmapCountyOn,
        heatmapStatewideOn,
        setHeatmapCounty,
        setHeatmapStatewide,
      }),
    { initialProps: initial },
  );
  return { ...utils, setHeatmapCounty, setHeatmapStatewide };
}

describe("useAutoDisableHeatmap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when fewer than 3 counties are selected", () => {
    const { result, setHeatmapCounty, setHeatmapStatewide } = renderTarget({
      selectedCountiesSize: 2,
      heatmapCountyOn: true,
      heatmapStatewideOn: false,
    });
    expect(setHeatmapCounty).not.toHaveBeenCalled();
    expect(setHeatmapStatewide).not.toHaveBeenCalled();
    expect(result.current.noteVisible).toBe(false);
  });

  it("auto-disables both heatmap layers and shows the note when crossing to 3", () => {
    const { result, rerender, setHeatmapCounty, setHeatmapStatewide } = renderTarget({
      selectedCountiesSize: 2,
      heatmapCountyOn: true,
      heatmapStatewideOn: false,
    });

    act(() => {
      rerender({ selectedCountiesSize: 3, heatmapCountyOn: true, heatmapStatewideOn: false });
    });

    expect(setHeatmapCounty).toHaveBeenCalledWith(false);
    expect(setHeatmapStatewide).toHaveBeenCalledWith(false);
    expect(result.current.noteVisible).toBe(true);
  });

  it("does not re-disable if the user manually re-enables the layer", () => {
    const { rerender, setHeatmapCounty, setHeatmapStatewide } = renderTarget({
      selectedCountiesSize: 3,
      heatmapCountyOn: true,
      heatmapStatewideOn: false,
    });

    expect(setHeatmapCounty).toHaveBeenCalledTimes(1);
    expect(setHeatmapStatewide).toHaveBeenCalledTimes(1);
    setHeatmapCounty.mockClear();
    setHeatmapStatewide.mockClear();

    // Simulate user manually flipping the heatmap layer back on while still
    // at 3+ counties — the hook should respect that, not fight it.
    act(() => {
      rerender({ selectedCountiesSize: 3, heatmapCountyOn: true, heatmapStatewideOn: false });
    });

    expect(setHeatmapCounty).not.toHaveBeenCalled();
    expect(setHeatmapStatewide).not.toHaveBeenCalled();
  });

  it("resets the auto-disable lock when the selection drops below 3", () => {
    const { rerender, setHeatmapCounty } = renderTarget({
      selectedCountiesSize: 3,
      heatmapCountyOn: true,
      heatmapStatewideOn: false,
    });
    expect(setHeatmapCounty).toHaveBeenCalledTimes(1);
    setHeatmapCounty.mockClear();

    // Drop below threshold — lock resets.
    act(() => {
      rerender({ selectedCountiesSize: 2, heatmapCountyOn: true, heatmapStatewideOn: false });
    });
    expect(setHeatmapCounty).not.toHaveBeenCalled();

    // Cross back above with heatmap on — should auto-disable again.
    act(() => {
      rerender({ selectedCountiesSize: 3, heatmapCountyOn: true, heatmapStatewideOn: false });
    });
    expect(setHeatmapCounty).toHaveBeenCalledWith(false);
  });

  it("does not fire when 3+ counties are selected but no heatmap layer is on", () => {
    const { result, setHeatmapCounty, setHeatmapStatewide } = renderTarget({
      selectedCountiesSize: 4,
      heatmapCountyOn: false,
      heatmapStatewideOn: false,
    });
    expect(setHeatmapCounty).not.toHaveBeenCalled();
    expect(setHeatmapStatewide).not.toHaveBeenCalled();
    expect(result.current.noteVisible).toBe(false);
  });

  it("auto-dismisses the note after 5 seconds", () => {
    const { result } = renderTarget({
      selectedCountiesSize: 3,
      heatmapCountyOn: true,
      heatmapStatewideOn: false,
    });
    expect(result.current.noteVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.noteVisible).toBe(false);
  });

  it("dismissNote() hides the note immediately", () => {
    const { result } = renderTarget({
      selectedCountiesSize: 3,
      heatmapCountyOn: true,
      heatmapStatewideOn: false,
    });
    expect(result.current.noteVisible).toBe(true);

    act(() => {
      result.current.dismissNote();
    });
    expect(result.current.noteVisible).toBe(false);
  });
});
