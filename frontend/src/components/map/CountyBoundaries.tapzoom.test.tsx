import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import L from "leaflet";
import { geoJSONLayerMock, featureLayerMocks, mockMapInstance } from "../../__mocks__/leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));
vi.mock("topojson-client", () => ({
  feature: () => ({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { name: "Fresno", county_code: 19 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ],
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayersStateProvider } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import { MemoryRouter } from "react-router-dom";

import CountyBoundaries from "./CountyBoundaries";

/**
 * Tapping a heatmap hotspot on a phone used to fall through the (pointer-events:
 * none) heat canvas onto whichever county polygon sat underneath, swapping the
 * whole view. On touch widths with a heat layer on, a tap zooms instead.
 */
describe("CountyBoundaries tap-to-zoom", () => {
  const onFocusCounty = vi.fn();
  const onSelectCounty = vi.fn();

  function setViewportWidth(touch: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: touch && query.includes("max-width"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    geoJSONLayerMock.eachLayer.mockImplementation((cb: (layer: unknown) => void) => {
      for (const fl of featureLayerMocks) cb(fl);
    });
    mockMapInstance.getZoom.mockReturnValue(7);
    mockMapInstance.getMaxZoom.mockReturnValue(18);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ca-counties.topo.json")) {
        return { ok: true, json: () => Promise.resolve({ type: "Topology", objects: { counties: {} }, arcs: [] }) } as Response;
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([{ county_code: 19, county_name: "Fresno", crash_count: 200, total_killed: 10, total_injured: 80 }]));
      }
      if (url.includes("/api/demographics")) {
        return new Response(JSON.stringify([{ county_code: 19, year: 2023, population: 1_000_000 }]));
      }
      throw new Error("Unexpected fetch: " + url);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    mockMapInstance.getZoom.mockReturnValue(6);
  });

  /** Renders, then returns the per-feature `click` handler Leaflet would fire. */
  async function tapCounty({ touch, heatmapActive }: { touch: boolean; heatmapActive: boolean }) {
    setViewportWidth(touch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <CustomThemeProvider><LayersStateProvider>
              <CountyBoundaries
                focusedCounty={null}
                heatmapActive={heatmapActive}
                onFocusCounty={onFocusCounty}
                onSelectCounty={onSelectCounty}
              />
            </LayersStateProvider></CustomThemeProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(L.geoJSON).toHaveBeenCalled());

    const options = vi.mocked(L.geoJSON).mock.calls[0][1] as {
      onEachFeature: (f: unknown, layer: { on: (h: Record<string, (e: unknown) => void>) => void }) => void;
    };
    let handlers: Record<string, (e: unknown) => void> = {};
    options.onEachFeature(
      { type: "Feature", properties: { name: "Fresno", county_code: 19 }, geometry: {} },
      { on: (h) => { handlers = h; } },
    );
    handlers.click({ latlng: { lat: 36.6, lng: -119.5 } });
  }

  it("zooms toward the tapped point instead of selecting the county", async () => {
    await tapCounty({ touch: true, heatmapActive: true });
    expect(mockMapInstance.setView).toHaveBeenCalledWith(
      { lat: 36.6, lng: -119.5 },
      9, // zoom 7 + two steps
      expect.objectContaining({ animate: true }),
    );
    expect(onSelectCounty).not.toHaveBeenCalled();
    expect(onFocusCounty).not.toHaveBeenCalled();
  });

  it("respects the map's max zoom", async () => {
    mockMapInstance.getZoom.mockReturnValue(9);
    mockMapInstance.getMaxZoom.mockReturnValue(10);
    await tapCounty({ touch: true, heatmapActive: true });
    expect(mockMapInstance.setView).toHaveBeenCalledWith(
      expect.anything(),
      10,
      expect.anything(),
    );
  });

  it("selects the county when there is no room left to zoom", async () => {
    mockMapInstance.getZoom.mockReturnValue(18);
    mockMapInstance.getMaxZoom.mockReturnValue(18);
    await tapCounty({ touch: true, heatmapActive: true });
    expect(mockMapInstance.setView).not.toHaveBeenCalled();
    expect(onSelectCounty).toHaveBeenCalledWith("Fresno");
  });

  it("still selects the county on desktop with a heat layer on", async () => {
    await tapCounty({ touch: false, heatmapActive: true });
    expect(mockMapInstance.setView).not.toHaveBeenCalled();
    expect(onFocusCounty).toHaveBeenCalledWith("Fresno");
    expect(onSelectCounty).toHaveBeenCalledWith("Fresno");
  });

  it("still selects the county on touch when no heat layer is on", async () => {
    await tapCounty({ touch: true, heatmapActive: false });
    expect(mockMapInstance.setView).not.toHaveBeenCalled();
    expect(onSelectCounty).toHaveBeenCalledWith("Fresno");
  });
});
