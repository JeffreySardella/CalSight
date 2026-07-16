import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStagedFilters, type StagedFilters } from "./useStagedFilters";

const empty: StagedFilters = {
  selectedYears: new Set(),
  dateRange: null,
  severities: new Set(),
  causes: new Set(),
  alcohol: false,
  distracted: false,
  pedestrian: false,
  cyclist: false,
  drug: false,
  driverAge: null,
  weather: new Set(),
  lighting: new Set(),
  collisionType: new Set(),
  roadType: null,
  hitRun: false,
};

describe("useStagedFilters", () => {
  it("starts from the initial value with no filters active", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    expect(result.current.staged).toEqual(empty);
    expect(result.current.hasAnyFilter).toBe(false);
  });

  it("toggles a year on and off", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    act(() => result.current.toggleYear(2022));
    expect(result.current.staged.selectedYears).toEqual(new Set([2022]));
    expect(result.current.hasAnyFilter).toBe(true);
    act(() => result.current.toggleYear(2022));
    expect(result.current.staged.selectedYears.size).toBe(0);
  });

  it("setAllYears clears the year selection (empty set = all years)", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    act(() => result.current.toggleYear(2019));
    act(() => result.current.setAllYears());
    expect(result.current.staged.selectedYears.size).toBe(0);
  });

  it("toggles severities and causes independently and clears each", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    act(() => result.current.toggleSeverity("Fatal"));
    act(() => result.current.toggleCause("dui"));
    expect(result.current.staged.severities).toEqual(new Set(["Fatal"]));
    expect(result.current.staged.causes).toEqual(new Set(["dui"]));
    act(() => result.current.clearSeverities());
    expect(result.current.staged.severities.size).toBe(0);
    expect(result.current.staged.causes.size).toBe(1);
    act(() => result.current.clearCauses());
    expect(result.current.staged.causes.size).toBe(0);
  });

  it("toggles involvement flags by key", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    act(() => result.current.toggleInvolvement("alcohol"));
    expect(result.current.staged.alcohol).toBe(true);
    expect(result.current.staged.pedestrian).toBe(false);
    act(() => result.current.toggleInvolvement("alcohol"));
    expect(result.current.staged.alcohol).toBe(false);
  });

  it("sets and clears a date range", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    act(() =>
      result.current.setDateRange({ year: 2020, month: 1 }, { year: 2021, month: 6 }),
    );
    expect(result.current.staged.dateRange).toEqual({
      start: { year: 2020, month: 1 },
      end: { year: 2021, month: 6 },
    });
    act(() => result.current.setDateRange(null, null));
    expect(result.current.staged.dateRange).toBeNull();
  });

  it("clearAll wipes every staged filter", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    act(() => {
      result.current.toggleYear(2020);
      result.current.toggleSeverity("Fatal");
      result.current.toggleInvolvement("cyclist");
      result.current.setRoadType("highway");
      result.current.toggleHitRun();
    });
    expect(result.current.hasAnyFilter).toBe(true);
    act(() => result.current.clearAll());
    expect(result.current.staged).toEqual(empty);
    expect(result.current.hasAnyFilter).toBe(false);
  });

  it("reset replaces staged state wholesale", () => {
    const { result } = renderHook(() => useStagedFilters(empty));
    const target = { ...empty, selectedYears: new Set([2018]), alcohol: true };
    act(() => result.current.reset(target));
    expect(result.current.staged).toEqual(target);
  });

  it("re-syncs when the initial value identity changes (applied filters updated elsewhere)", () => {
    const first = { ...empty, selectedYears: new Set([2017]) };
    const second = { ...empty, selectedYears: new Set([2023]) };
    const { result, rerender } = renderHook(
      ({ initial }) => useStagedFilters(initial),
      { initialProps: { initial: first } },
    );
    // Local edits survive rerenders with the SAME initial object…
    act(() => result.current.toggleSeverity("Fatal"));
    rerender({ initial: first });
    expect(result.current.staged.severities).toEqual(new Set(["Fatal"]));
    // …but a NEW initial object replaces the staged state.
    rerender({ initial: second });
    expect(result.current.staged.selectedYears).toEqual(new Set([2023]));
    expect(result.current.staged.severities.size).toBe(0);
  });

  describe("has2016Plus", () => {
    it("is true with no year filters at all", () => {
      const { result } = renderHook(() => useStagedFilters(empty));
      expect(result.current.has2016Plus).toBe(true);
    });

    it("is false when only pre-2016 years are selected", () => {
      const { result } = renderHook(() => useStagedFilters(empty));
      act(() => result.current.toggleYear(2012));
      expect(result.current.has2016Plus).toBe(false);
      act(() => result.current.toggleYear(2019));
      expect(result.current.has2016Plus).toBe(true);
    });

    it("uses the date-range end year when a range is set", () => {
      const { result } = renderHook(() => useStagedFilters(empty));
      act(() =>
        result.current.setDateRange({ year: 2010, month: 1 }, { year: 2014, month: 12 }),
      );
      expect(result.current.has2016Plus).toBe(false);
      // An open-ended range (no end) runs to the present → includes 2016+.
      act(() => result.current.setDateRange({ year: 2010, month: 1 }, null));
      expect(result.current.has2016Plus).toBe(true);
    });
  });
});
