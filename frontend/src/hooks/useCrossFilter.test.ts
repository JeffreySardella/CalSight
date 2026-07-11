import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCrossFilter } from "./useCrossFilter";

describe("useCrossFilter", () => {
  it("starts with no selection and empty overrides", () => {
    const { result } = renderHook(() => useCrossFilter());
    expect(result.current.state).toEqual({ sourceChartId: null, selection: null });
    expect(result.current.toFilterOverrides()).toEqual({});
  });

  it("selects a category, toggles it off on second click, and replaces on a different value", () => {
    const { result } = renderHook(() => useCrossFilter());

    act(() => result.current.toggleCategory("chart-1", "severity", "Fatal"));
    expect(result.current.state).toEqual({
      sourceChartId: "chart-1",
      selection: { type: "category", dimension: "severity", values: ["Fatal"] },
    });

    // Same chart + same value → clears.
    act(() => result.current.toggleCategory("chart-1", "severity", "Fatal"));
    expect(result.current.state.selection).toBeNull();

    // Different value replaces instead of clearing.
    act(() => result.current.toggleCategory("chart-1", "severity", "Fatal"));
    act(() => result.current.toggleCategory("chart-1", "severity", "Injury"));
    expect(result.current.state.selection?.values).toEqual(["Injury"]);
  });

  it("clicking the same value from a DIFFERENT chart re-selects rather than clears", () => {
    const { result } = renderHook(() => useCrossFilter());
    act(() => result.current.toggleCategory("chart-1", "severity", "Fatal"));
    act(() => result.current.toggleCategory("chart-2", "severity", "Fatal"));
    expect(result.current.state.sourceChartId).toBe("chart-2");
    expect(result.current.state.selection?.values).toEqual(["Fatal"]);
  });

  it("clearCrossFilter resets the selection", () => {
    const { result } = renderHook(() => useCrossFilter());
    act(() => result.current.toggleCategory("chart-1", "county", "Kern"));
    act(() => result.current.clearCrossFilter());
    expect(result.current.state).toEqual({ sourceChartId: null, selection: null });
    expect(result.current.toFilterOverrides()).toEqual({});
  });

  describe("toFilterOverrides", () => {
    it("maps known severity labels to API slugs", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "severity", "Property Damage Only"));
      expect(result.current.toFilterOverrides()).toEqual({ severity: "property-damage-only" });
    });

    it("slugifies unknown severity labels as a fallback", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "severity", "Minor Injury"));
      expect(result.current.toFilterOverrides()).toEqual({ severity: "minor-injury" });
    });

    it("maps cause labels through the explicit slug table", () => {
      const { result } = renderHook(() => useCrossFilter());

      act(() => result.current.toggleCategory("c", "cause", "DUI"));
      expect(result.current.toFilterOverrides()).toEqual({ cause: "dui" });

      // Non-trivial mappings that plain slugification would get wrong.
      act(() => result.current.toggleCategory("c", "cause", "Improper Turn"));
      expect(result.current.toFilterOverrides()).toEqual({ cause: "turning" });

      act(() => result.current.toggleCategory("c", "cause", "Tailgating"));
      expect(result.current.toFilterOverrides()).toEqual({ cause: "following-too-close" });

      act(() => result.current.toggleCategory("c", "cause", "Pedestrian"));
      expect(result.current.toFilterOverrides()).toEqual({ cause: "pedestrian-violation" });
    });

    it("slugifies unknown cause labels as a fallback", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "cause", "Wrong Side Of Road"));
      expect(result.current.toFilterOverrides()).toEqual({ cause: "wrong-side-of-road" });
    });

    it("lowercases and hyphenates county names", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "county", "Los Angeles"));
      expect(result.current.toFilterOverrides()).toEqual({ county: "los-angeles" });
    });

    it("expands a year selection into a start/end month range", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "year", "2019"));
      expect(result.current.toFilterOverrides()).toEqual({ start: "2019-01", end: "2019-12" });
    });

    it("returns empty overrides for an unparseable year", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "year", "unknown"));
      expect(result.current.toFilterOverrides()).toEqual({});
    });

    it("returns empty overrides for dimensions with no API mapping", () => {
      const { result } = renderHook(() => useCrossFilter());
      act(() => result.current.toggleCategory("c", "hour", "2 AM"));
      expect(result.current.toFilterOverrides()).toEqual({});
    });
  });
});
