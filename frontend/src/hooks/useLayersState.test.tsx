import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { LayersStateProvider, useLayersState } from "./useLayersState";
import { DEFAULT_MEASURE } from "../lib/choropleth/measures";

function wrap({ children }: { children: ReactNode }) {
  return <LayersStateProvider>{children}</LayersStateProvider>;
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

  it("throws when used outside provider", () => {
    expect(() => renderHook(() => useLayersState())).toThrow(/LayersStateProvider/);
  });

  it("provides default heatmapResolution of 'low'", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    expect(result.current.heatmapResolution).toBe("low");
  });

  it("setHeatmapResolution updates resolution", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setHeatmapResolution("high"));
    expect(result.current.heatmapResolution).toBe("high");
  });

  it("reset restores heatmapResolution to low", () => {
    const { result } = renderHook(() => useLayersState(), { wrapper: wrap });
    act(() => result.current.setHeatmapResolution("high"));
    act(() => result.current.reset());
    expect(result.current.heatmapResolution).toBe("low");
  });
});
