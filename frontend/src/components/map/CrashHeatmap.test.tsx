import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// react-leaflet's useMap returns a STABLE map instance across renders. The
// mock must do the same, otherwise effects keyed on `map` would re-run every
// render and mask dependency bugs.
const mockMap = {
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  hasLayer: vi.fn(() => false),
  getZoom: vi.fn(() => 6),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("react-leaflet", () => ({
  useMap: () => mockMap,
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

  it("creates the layer when points arrive after an initial empty render", async () => {
    vi.mocked(L.heatLayer).mockClear();
    const { useHeatLayer } = await import("./CrashHeatmap");

    const points = [
      { lat: 34.0, lng: -118.0, weight: 42 },
      { lat: 34.1, lng: -118.1, weight: 17 },
    ];

    // First render with no data yet (cold load: fetch not resolved).
    const { rerender } = renderHook(
      ({ pts }) => useHeatLayer(pts, "medium", "default", false),
      { initialProps: { pts: [] as typeof points } },
    );
    expect(L.heatLayer).not.toHaveBeenCalled();

    // Data arrives — the layer must now be created even though no style
    // prop (resolution/palette/isDark) changed.
    rerender({ pts: points });

    expect(L.heatLayer).toHaveBeenCalled();
  });

  it("cancels a pending redraw animation frame before removing the layer", async () => {
    // leaflet.heat's onRemove() nulls the canvas/listeners but never cancels
    // a requestAnimationFrame already scheduled by redraw() — when that frame
    // fires afterward it reads the now-null `_map` and throws. Regression for
    // the map's init-time "Cannot read properties of null (reading 'getSize')"
    // crash: removeHeatLayer must cancel it first.
    vi.mocked(L.heatLayer).mockClear();
    const cancelSpy = vi.spyOn(L.Util, "cancelAnimFrame");
    const { useHeatLayer } = await import("./CrashHeatmap");

    const points = [
      { lat: 34.0, lng: -118.0, weight: 42 },
      { lat: 34.1, lng: -118.1, weight: 17 },
    ];

    const { unmount } = renderHook(() => useHeatLayer(points, "medium", "default", false));

    // Simulate leaflet.heat's redraw() having scheduled a requestAnimationFrame
    // (e.g. from a streamed setLatLngs) that hasn't fired yet when we tear down.
    const layer = vi.mocked(L.heatLayer).mock.results[0].value as { _frame?: number };
    layer._frame = 12345;

    unmount();

    expect(cancelSpy).toHaveBeenCalledWith(12345);
    expect(mockMap.removeLayer).toHaveBeenCalledWith(layer);
    cancelSpy.mockRestore();
  });

  it("skips drawing while the map has no size, and frees the frame slot", async () => {
    // simpleheat's draw() calls getImageData(0, 0, w, h), which throws
    // IndexSizeError at w or h of 0 (map not laid out yet / hidden mobile tab).
    vi.mocked(L.heatLayer).mockClear();
    const { useHeatLayer } = await import("./CrashHeatmap");
    const realDraw = vi.fn();
    const size = { x: 0, y: 0 };
    (mockMap as unknown as { getSize: () => typeof size }).getSize = () => size;
    vi.mocked(L.heatLayer).mockImplementationOnce(() => ({
      setLatLngs: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      setOptions: vi.fn().mockReturnThis(),
      _redraw: realDraw,
      _frame: 7,
    }) as unknown as L.HeatLayer);

    renderHook(() => useHeatLayer([{ lat: 34, lng: -118, weight: 1 }], "medium", "default", false));
    const layer = vi.mocked(L.heatLayer).mock.results[0].value as { _redraw: () => void; _frame?: number };

    layer._redraw();
    expect(realDraw).not.toHaveBeenCalled();
    // A frame id left behind would make leaflet.heat's redraw() a no-op forever.
    expect(layer._frame).toBeUndefined();

    size.x = 375;
    size.y = 708;
    layer._redraw();
    expect(realDraw).toHaveBeenCalledTimes(1);
  });
});

describe("useFatalLayer", () => {
  const fatalPoints = [
    { lat: 34.0, lng: -118.0, weight: 3, severity: "Fatal" },
    { lat: 34.1, lng: -118.1, weight: 2, severity: "Injury" },
  ];

  it("builds the fatal heat layer once and does not rebuild when the gradient reference is stable (P-4)", async () => {
    vi.mocked(L.heatLayer).mockClear();
    const { useFatalLayer } = await import("./CrashHeatmap");

    // A memoized gradient keeps the same reference across renders.
    const gradient = { 0: "transparent", 0.3: "#f00", 0.6: "#a00", 1.0: "#500" };

    const { rerender } = renderHook(
      ({ g }) => useFatalLayer(fatalPoints, "raw", g),
      { initialProps: { g: gradient } },
    );

    expect(L.heatLayer).toHaveBeenCalledTimes(1);

    // Re-render with the SAME gradient object (simulating an unrelated parent
    // re-render). The effect must NOT tear down and rebuild the layer.
    rerender({ g: gradient });
    rerender({ g: gradient });

    expect(L.heatLayer).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the gradient reference changes, proving the dep is live", async () => {
    vi.mocked(L.heatLayer).mockClear();
    const { useFatalLayer } = await import("./CrashHeatmap");

    const { rerender } = renderHook(
      ({ g }) => useFatalLayer(fatalPoints, "raw", g),
      { initialProps: { g: { 0: "transparent", 1.0: "#500" } } },
    );

    expect(L.heatLayer).toHaveBeenCalledTimes(1);

    // A fresh object literal (what an unmemoized gradient would produce every
    // render) forces the rebuild the P-4 fix's useMemo is meant to prevent.
    rerender({ g: { 0: "transparent", 1.0: "#500" } });

    expect(L.heatLayer).toHaveBeenCalledTimes(2);
  });

  it("does not build a fatal layer outside raw resolution", async () => {
    vi.mocked(L.heatLayer).mockClear();
    const { useFatalLayer } = await import("./CrashHeatmap");

    renderHook(() =>
      useFatalLayer(fatalPoints, "medium", { 0: "transparent", 1.0: "#500" }),
    );

    expect(L.heatLayer).not.toHaveBeenCalled();
  });
});
