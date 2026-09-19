import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useDrillDown } from "./useDrillDown";
import { resetSearchParamsBuffer } from "./useSearchParamsWriter";

function wrap(initialEntries: string[]) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
}

describe("useDrillDown", () => {
  beforeEach(() => resetSearchParamsBuffer());

  it("defaults to state level with no county when drill_county is absent", () => {
    const { result } = renderHook(() => useDrillDown(), { wrapper: wrap(["/"]) });
    expect(result.current.drillState).toEqual({ level: "state", county: null });
  });

  it("reads a county level from the drill_county URL param, deslugified", () => {
    const { result } = renderHook(() => useDrillDown(), {
      wrapper: wrap(["/?drill_county=los-angeles"]),
    });
    expect(result.current.drillState).toEqual({ level: "county", county: "Los Angeles" });
  });

  it("drillToCounty writes the slug and flips drillState to county level", async () => {
    const { result } = renderHook(() => useDrillDown(), { wrapper: wrap(["/"]) });

    act(() => result.current.drillToCounty("kern"));

    await waitFor(() => {
      expect(result.current.drillState).toEqual({ level: "county", county: "Kern" });
    });
  });

  it("drillUp clears drill_county and returns to state level", async () => {
    const { result } = renderHook(() => useDrillDown(), {
      wrapper: wrap(["/?drill_county=fresno"]),
    });
    expect(result.current.drillState.level).toBe("county");

    act(() => result.current.drillUp());

    await waitFor(() => {
      expect(result.current.drillState).toEqual({ level: "state", county: null });
    });
  });

  it("resetDrill also clears drill_county", async () => {
    const { result } = renderHook(() => useDrillDown(), {
      wrapper: wrap(["/?drill_county=orange"]),
    });

    act(() => result.current.resetDrill());

    await waitFor(() => {
      expect(result.current.drillState).toEqual({ level: "state", county: null });
    });
  });
});
