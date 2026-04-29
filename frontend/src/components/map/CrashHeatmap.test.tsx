import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("react-leaflet", () => ({
  useMap: () => ({
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
  }),
}));

vi.mock("leaflet", async () => {
  const actual = await vi.importActual<typeof import("leaflet")>("leaflet");
  const heatLayerFn = vi.fn(() => ({
    setLatLngs: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
    setOptions: vi.fn().mockReturnThis(),
    redraw: vi.fn().mockReturnThis(),
  }));
  return {
    default: {
      ...(actual as unknown as Record<string, unknown>),
      heatLayer: heatLayerFn,
    },
  };
});

import L from "leaflet";

describe("CrashHeatmap", () => {
  it("creates a heat layer when given points", async () => {
    const { useHeatLayer } = await import("./CrashHeatmap");

    const points = [
      { lat: 34.0, lng: -118.0, weight: 42 },
      { lat: 34.1, lng: -118.1, weight: 17 },
    ];

    renderHook(() => useHeatLayer(points, "medium", "default", false));

    expect(L.heatLayer).toHaveBeenCalled();
  });

  it("does not create a layer when points are empty", async () => {
    vi.mocked(L.heatLayer).mockClear();
    const { useHeatLayer } = await import("./CrashHeatmap");

    renderHook(() => useHeatLayer([], "medium", "default", false));

    expect(L.heatLayer).not.toHaveBeenCalled();
  });
});
