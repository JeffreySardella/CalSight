// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSavedDashboards } from "./useSavedDashboards";
import { PRESET_KEYS } from "../lib/dashboard/presets";
import { DIMENSIONS, MEASURES } from "../lib/dashboard/types";

const KEY = "calsight-saved-dashboards-v1";
const validConfig = {
  mode: "simple",
  preset: PRESET_KEYS[0],
  charts: [{ id: "a", order: 0, dimension: DIMENSIONS[0], measure: MEASURES[0], chartType: "bar" }],
};
const entry = (id: string, config: unknown) => ({
  id, name: id, savedAt: new Date().toISOString(), config,
});

beforeEach(() => localStorage.clear());

describe("useSavedDashboards (M-F5)", () => {
  it("load returns null for a corrupt saved config instead of a crashing one", () => {
    localStorage.setItem(KEY, JSON.stringify([entry("bad", { mode: "garbage", charts: "nope" })]));
    const { result } = renderHook(() => useSavedDashboards());
    expect(result.current.load("bad")).toBeNull();
  });

  it("load returns a valid saved config unchanged", () => {
    localStorage.setItem(KEY, JSON.stringify([entry("ok", validConfig)]));
    const { result } = renderHook(() => useSavedDashboards());
    expect(result.current.load("ok")).toEqual(validConfig);
  });

  it("drops garbage array entries so list doesn't choke", () => {
    localStorage.setItem(KEY, JSON.stringify([null, "x", 42, entry("ok", validConfig)]));
    const { result } = renderHook(() => useSavedDashboards());
    expect(result.current.list()).toHaveLength(1);
    expect(result.current.list()[0].id).toBe("ok");
  });
});
