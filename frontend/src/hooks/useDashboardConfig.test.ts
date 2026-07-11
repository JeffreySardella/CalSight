import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as safeStorage from "../lib/safeStorage";
import { useDashboardConfig } from "./useDashboardConfig";

const STORAGE_KEY = "calsight-dashboard-v1";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
