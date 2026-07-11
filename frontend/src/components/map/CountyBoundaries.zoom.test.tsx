import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import L from "leaflet";
import { geoJSONLayerMock, mockMapInstance } from "../../__mocks__/leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));
vi.mock("topojson-client", () => ({
  feature: () => ({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { name: "Fresno", county_code: 19 }, geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } },
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
 * County deep-link auto-zoom (#256): focusing a county fits the map to its
 * polygon bounds. The zoom animation must be suppressed under the effective
 * reduced-motion preference (the `.reduce-motion` class on <html>).
 */
describe("CountyBoundaries focus zoom", () => {
  const onFocusCounty = vi.fn();
  const onSelectCounty = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove("reduce-motion");
    // A single Fresno feature layer with usable bounds.
    geoJSONLayerMock.eachLayer.mockImplementation((cb: (layer: unknown) => void) => {
      cb({
        feature: { type: "Feature", properties: { name: "Fresno", county_code: 19 }, geometry: {} },
        getBounds: () => ({
          getCenter: () => ({ lat: 36.7, lng: -119.8 }),
          extend: vi.fn(),
        }),
      });
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ca-counties.topo.json")) {
        return { ok: true, json: () => Promise.resolve({ type: "Topology", objects: { counties: {} }, arcs: [] }) } as Response;
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 19, county_name: "Fresno", crash_count: 200, total_killed: 10, total_injured: 80 },
        ]));
      }
      if (url.includes("/api/demographics")) {
        return new Response(JSON.stringify([{ county_code: 19, year: 2023, population: 1_000_000 }]));
      }
      throw new Error("Unexpected fetch: " + url);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    document.documentElement.classList.remove("reduce-motion");
  });

  async function focusFresno() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (focusedCounty: string | null) => (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <CustomThemeProvider><LayersStateProvider>
              <CountyBoundaries
                focusedCounty={focusedCounty}
                onFocusCounty={onFocusCounty}
                onSelectCounty={onSelectCounty}
              />
            </LayersStateProvider></CustomThemeProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const { rerender } = render(tree(null));
    await waitFor(() => expect(L.geoJSON).toHaveBeenCalled());
    rerender(tree("Fresno"));
    await waitFor(() => expect(mockMapInstance.fitBounds).toHaveBeenCalled());
    const calls = vi.mocked(mockMapInstance.fitBounds).mock.calls;
    return calls[calls.length - 1][1] as { animate: boolean; maxZoom: number };
  }

  it("fits the map to the focused county's bounds with an animated zoom", async () => {
    const options = await focusFresno();
    expect(options.animate).toBe(true);
    expect(options.maxZoom).toBe(11);
  });

  it("does not animate the zoom under reduced motion", async () => {
    document.documentElement.classList.add("reduce-motion");
    const options = await focusFresno();
    expect(options.animate).toBe(false);
  });
});
