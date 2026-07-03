import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { insertionIndexToItemIndex } from "./useDragReorder";
import { useDashboardConfig } from "./useDashboardConfig";
import type { Dimension } from "../lib/dashboard/types";

/**
 * Regression tests for the drag-reorder off-by-one: getDropIndex produces an
 * insertion index (0..N, where N means "after the last item"), while
 * reorderChart expects the final item index. insertionIndexToItemIndex is the
 * conversion applied in useDragReorder's drop handler; these tests drive the
 * real reorderChart with the converted index, exactly like a completed drag.
 */

const DIMS: Dimension[] = ["year", "county", "severity", "hour"];

function setupCharts() {
  const rendered = renderHook(() => useDashboardConfig());
  act(() => {
    rendered.result.current.setMode("advanced");
  });
  act(() => {
    for (const dimension of DIMS) {
      rendered.result.current.addChart({ dimension, measure: "count", chartType: "bar" });
    }
  });
  return rendered;
}

function dimensionOrder(result: { current: ReturnType<typeof useDashboardConfig> }): string[] {
  return [...result.current.config.charts]
    .sort((a, b) => a.order - b.order)
    .map((c) => c.dimension);
}

/** Simulate a completed drag from `fromIndex` to insertion index `insertionIndex`. */
function drop(
  result: { current: ReturnType<typeof useDashboardConfig> },
  fromIndex: number,
  insertionIndex: number,
) {
  const toIndex = insertionIndexToItemIndex(fromIndex, insertionIndex);
  if (toIndex !== fromIndex) {
    act(() => result.current.reorderChart(fromIndex, toIndex));
  }
}

describe("insertionIndexToItemIndex", () => {
  it("keeps upward moves unchanged", () => {
    expect(insertionIndexToItemIndex(3, 1)).toBe(1);
    expect(insertionIndexToItemIndex(2, 0)).toBe(0);
  });

  it("shifts downward moves left by one (removal shifts later items)", () => {
    expect(insertionIndexToItemIndex(0, 2)).toBe(1);
    expect(insertionIndexToItemIndex(1, 3)).toBe(2);
  });

  it("maps an end-of-list drop to the last item index", () => {
    expect(insertionIndexToItemIndex(0, 4)).toBe(3);
  });

  it("treats dropping on itself (before or after) as a no-op", () => {
    expect(insertionIndexToItemIndex(2, 2)).toBe(2);
    expect(insertionIndexToItemIndex(2, 3)).toBe(2);
  });
});

describe("drag reorder applied to the dashboard config", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/stats");
  });

  it("drops at the end of the list", () => {
    const { result } = setupCharts();
    // Dragging the first card past the last card: insertion index = length.
    drop(result, 0, 4);
    expect(dimensionOrder(result)).toEqual(["county", "severity", "hour", "year"]);
  });

  it("downward drop lands where the insertion indicator showed", () => {
    const { result } = setupCharts();
    // Indicator before item 2 ("severity"): the dragged card must end up
    // immediately before "severity", not one slot past it.
    drop(result, 0, 2);
    expect(dimensionOrder(result)).toEqual(["county", "year", "severity", "hour"]);
  });

  it("upward drop lands at the insertion index", () => {
    const { result } = setupCharts();
    drop(result, 3, 1);
    expect(dimensionOrder(result)).toEqual(["year", "hour", "county", "severity"]);
  });

  it("dropping a card on itself is a no-op", () => {
    const { result } = setupCharts();
    const before = result.current.config.charts;
    drop(result, 1, 1); // insertion right before itself
    drop(result, 1, 2); // insertion right after itself
    expect(result.current.config.charts).toBe(before);
    expect(dimensionOrder(result)).toEqual(["year", "county", "severity", "hour"]);
  });

  it("keeps built charts when toggling out of and back into builder mode", () => {
    const { result } = setupCharts();
    act(() => result.current.setMode("simple"));
    act(() => result.current.setMode("advanced"));
    expect(dimensionOrder(result)).toEqual(["year", "county", "severity", "hour"]);
  });
});
