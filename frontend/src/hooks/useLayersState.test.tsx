import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { LayersStateProvider, useLayersState } from "./useLayersState";
import { ThemeProvider } from "../context/ThemeContext";
import { CustomThemeProvider } from "../context/CustomThemeContext";
import { DEFAULT_MEASURE } from "../lib/choropleth/measures";
import * as safeStorage from "../lib/safeStorage";

const STORAGE_KEY = "calsight-layers";

function wrap({ children }: { children: ReactNode }) {
  return <ThemeProvider><CustomThemeProvider><LayersStateProvider>{children}</LayersStateProvider></CustomThemeProvider></ThemeProvider>;
}

describe("useLayersState", () => {
  it("provides default values", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    expect(result.current.choroplethOn).toBe(true);
    expect(result.current.measure).toBe(DEFAULT_MEASURE);
    expect(result.current.palette).toBe("default");
    expect(result.current.bucketEdges).toBeNull();
  });

  it("setMeasure updates measure", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setMeasure("fatality_rate"));
    expect(result.current.measure).toBe("fatality_rate");
  });

  it("setPalette updates palette", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setPalette("colorblind"));
    expect(result.current.palette).toBe("colorblind");
  });

  it("setChoroplethOn toggles", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setChoroplethOn(false));
    expect(result.current.choroplethOn).toBe(false);
  });

  it("setBucketEdges stores edges for legend consumption", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setBucketEdges([0, 10, 20, 30, 40, 50]));
    expect(result.current.bucketEdges).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it("highwayDanger layer defaults off and toggles", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    expect(result.current.otherLayers.highwayDanger).toBe(false);
    act(() => result.current.setOtherLayer("highwayDanger", true));
    expect(result.current.otherLayers.highwayDanger).toBe(true);
  });

  it("highwayMetric defaults to fatality_rate and updates", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    expect(result.current.highwayMetric).toBe("fatality_rate");
    act(() => result.current.setHighwayMetric("crash_count"));
    expect(result.current.highwayMetric).toBe("crash_count");
  });

  it("throws when used outside provider", () => {
    expect(() => renderHook(() => useLayersState())).toThrow(/LayersStateProvider/);
  });

  it("provides default heatmapResolution of 'low'", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    expect(result.current.heatmapResolution).toBe("low");
  });

  it("setHeatmapResolution updates resolution", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setHeatmapResolution("low"));
    expect(result.current.heatmapResolution).toBe("low");
  });

  it("reset restores heatmapResolution to low", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setHeatmapResolution("medium"));
    act(() => result.current.reset());
    expect(result.current.heatmapResolution).toBe("low");
  });

  it("parses localStorage only once, not on every provider re-render", () => {
    const spy = vi.spyOn(safeStorage, "safeGetItem");
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    const countFor = () => spy.mock.calls.filter((c) => c[0] === STORAGE_KEY).length;
    const afterMount = countFor();
    expect(afterMount).toBe(1);
    // State updates re-render the provider; the lazy initializer must not re-parse.
    act(() => result.current.setMeasure("fatality_rate"));
    act(() => result.current.setPalette("colorblind"));
    act(() => result.current.setHeatmapResolution("medium"));
    expect(countFor()).toBe(afterMount);
    spy.mockRestore();
  });
});
