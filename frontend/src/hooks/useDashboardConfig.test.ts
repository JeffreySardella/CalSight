import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as safeStorage from "../lib/safeStorage";
import { useDashboardConfig } from "./useDashboardConfig";
import { encodeDashboard } from "../lib/dashboard/urlCodec";
import { parseNlq, resolveNlq } from "../lib/dashboard/nlqParser";
import type { DashboardConfig } from "../lib/dashboard/types";

const STORAGE_KEY = "calsight-dashboard-v1";

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("useDashboardConfig persistence", () => {
  it("debounces the save while mounted", () => {
    const setSpy = vi.spyOn(safeStorage, "safeSetItem");
    const { result } = renderHook(() => useDashboardConfig());

    act(() => { result.current.setMode("advanced"); });
    // Timer hasn't elapsed yet — no write.
    expect(setSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));

    act(() => { vi.advanceTimersByTime(400); });
    expect(setSpy).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
  });

  it("flushes a pending debounced save on unmount (fast navigate-away)", () => {
    const setSpy = vi.spyOn(safeStorage, "safeSetItem");
    const { result, unmount } = renderHook(() => useDashboardConfig());

    act(() => { result.current.setMode("advanced"); });
    // Unmount before the 400ms debounce fires.
    expect(setSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));

    unmount();
    // The last edit must have been persisted despite the pending timer.
    expect(setSpy).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    const persisted = setSpy.mock.calls.find((c) => c[0] === STORAGE_KEY)?.[1] as string;
    expect(JSON.parse(persisted).mode).toBe("advanced");
  });

  it("does not write on unmount when there is no pending edit", () => {
    const setSpy = vi.spyOn(safeStorage, "safeSetItem");
    const { unmount } = renderHook(() => useDashboardConfig());
    unmount();
    expect(setSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
  });
});

// #474 follow-up: gender/age_bracket/at_fault_* rows carry victim_count/
// party_count, not crash_count/total_killed, so fatality_rate and yoy_change
// (which need the crash-level series) always rendered a flat 0 for them. The
// ChartConfigPanel editor sanitizes its own initial/edited value, but every
// OTHER way a chart slot reaches the dashboard — addChart (Suggested Charts,
// the NLQ bar), updateChart, and a restored localStorage/URL dashboard —
// bypassed that check entirely. These assert the shared choke point in
// useDashboardConfig catches all of them.
describe("useDashboardConfig person-level measure sanitize (#474)", () => {
  it("addChart coerces fatality_rate to count for a person-level dimension", () => {
    const { result } = renderHook(() => useDashboardConfig());
    act(() => {
      result.current.addChart({ dimension: "gender", measure: "fatality_rate", chartType: "bar" });
    });
    expect(result.current.config.charts[0]).toMatchObject({ dimension: "gender", measure: "count" });
  });

  it("addChart leaves fatality_rate alone for a crash-level dimension (year)", () => {
    const { result } = renderHook(() => useDashboardConfig());
    act(() => {
      result.current.addChart({ dimension: "year", measure: "fatality_rate", chartType: "line" });
    });
    expect(result.current.config.charts[0]).toMatchObject({ dimension: "year", measure: "fatality_rate" });
  });

  it("updateChart coerces measure to count when a gender + fatality_rate update is applied", () => {
    const { result } = renderHook(() => useDashboardConfig());
    act(() => {
      result.current.addChart({ dimension: "year", measure: "count", chartType: "line" });
    });
    const id = result.current.config.charts[0].id;
    act(() => {
      result.current.updateChart(id, { dimension: "gender", measure: "fatality_rate" });
    });
    expect(result.current.config.charts[0]).toMatchObject({ dimension: "gender", measure: "count" });
  });

  it("loadInitialConfig sanitizes a stale localStorage dashboard carrying gender + fatality_rate", () => {
    const stale: DashboardConfig = {
      mode: "advanced",
      preset: "overview",
      charts: [{ id: "a", dimension: "gender", measure: "fatality_rate", secondaryMeasure: "yoy_change", chartType: "bar", order: 0 }],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    const { result } = renderHook(() => useDashboardConfig());
    expect(result.current.config.charts[0]).toMatchObject({ measure: "count", secondaryMeasure: undefined });
  });

  it("loadInitialConfig sanitizes a shared URL dashboard carrying gender + fatality_rate", () => {
    const shared: DashboardConfig = {
      mode: "advanced",
      preset: "overview",
      charts: [{ id: "b", dimension: "gender", measure: "fatality_rate", chartType: "bar", order: 0 }],
    };
    const encoded = encodeDashboard(shared);
    window.history.pushState({}, "", `?${new URLSearchParams({ dashboard: encoded }).toString()}`);
    const { result } = renderHook(() => useDashboardConfig());
    expect(result.current.config.charts[0]).toMatchObject({ dimension: "gender", measure: "count" });
  });

  it("an NLQ query for 'fatality rate by gender' ends up as count once added via addChart", () => {
    const resolved = resolveNlq(parseNlq("fatality rate by gender"));
    expect(resolved).toMatchObject({ dimension: "gender", measure: "fatality_rate" });

    const { result } = renderHook(() => useDashboardConfig());
    act(() => {
      result.current.addChart(resolved!);
    });
    expect(result.current.config.charts[0]).toMatchObject({ dimension: "gender", measure: "count" });
  });
});
