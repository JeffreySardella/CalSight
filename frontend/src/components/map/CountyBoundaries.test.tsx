import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import L from "leaflet";
import { geoJSONLayerMock, featureLayerMocks, mockMapInstance } from "../../__mocks__/leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayersStateProvider } from "../../hooks/useLayersState";
import { ThemeProvider } from "../../context/ThemeContext";
import { MemoryRouter } from "react-router-dom";

import CountyBoundaries from "./CountyBoundaries";

const FAKE_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Fresno", county_code: 19 },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    },
    {
      type: "Feature",
      properties: { name: "Alameda", county_code: 1 },
      geometry: { type: "Polygon", coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] },
    },
  ],
};

describe("CountyBoundaries", () => {
  let onFocusCounty: ReturnType<typeof vi.fn<(name: string | null) => void>>;
  let onSelectCounty: ReturnType<typeof vi.fn<(name: string) => void>>;

  beforeEach(() => {
    onFocusCounty = vi.fn<(name: string | null) => void>();
    onSelectCounty = vi.fn<(name: string) => void>();
    vi.clearAllMocks();
    // Restore eachLayer default implementation (tooltip test overrides it via mockImplementation,
    // and clearAllMocks does not restore implementations — only resetAllMocks does).
    geoJSONLayerMock.eachLayer.mockImplementation((cb: (layer: unknown) => void) => {
      for (const fl of featureLayerMocks) cb(fl);
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("ca-counties.geojson")) {
        return { json: () => Promise.resolve(FAKE_GEOJSON) } as Response;
      }
      if (url.includes("/api/stats")) {
        return new Response(JSON.stringify([
          { county_code: 1, county_name: "Alameda", crash_count: 100, total_killed: 5, total_injured: 40 },
          { county_code: 19, county_name: "Fresno", crash_count: 200, total_killed: 10, total_injured: 80 },
        ]));
      }
      if (url.includes("/api/demographics")) {
        return new Response(JSON.stringify([
          { county_code: 1, year: 2023, population: 1_000_000 },
          { county_code: 19, year: 2023, population: 1_000_000 },
        ]));
      }
      throw new Error("Unexpected fetch: " + url);
    }) as unknown as typeof fetch;
  });

  function renderComponent(focusedCounty: string | null = null) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider>
          <LayersStateProvider>
            <CountyBoundaries
              focusedCounty={focusedCounty}
              onFocusCounty={onFocusCounty}
              onSelectCounty={onSelectCounty}
            />
          </LayersStateProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("fetches /ca-counties.geojson on mount", async () => {
    renderComponent();
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/ca-counties.geojson");
    });
  });

  it("creates a GeoJSON layer after data loads", async () => {
    renderComponent();
    await waitFor(() => {
      expect(L.geoJSON).toHaveBeenCalled();
    });
    const callArg = vi.mocked(L.geoJSON).mock.calls[0][0] as GeoJSON.FeatureCollection;
    expect(callArg.features[0].properties?.name).toBe("Alameda");
    expect(callArg.features[1].properties?.name).toBe("Fresno");
  });

  it("adds the layer to the map", async () => {
    renderComponent();
    await waitFor(() => {
      expect(geoJSONLayerMock.addTo).toHaveBeenCalledWith(mockMapInstance);
    });
  });

  it("creates a tooltip when a county is focused", async () => {
    // Make eachLayer call back with a mock feature layer matching "Fresno"
    geoJSONLayerMock.eachLayer.mockImplementation((cb: (layer: unknown) => void) => {
      cb({
        feature: { type: "Feature", properties: { name: "Fresno", county_code: 19 }, geometry: {} },
        getBounds: () => ({
          getCenter: () => ({ lat: 36.7, lng: -119.8 }),
        }),
      });
    });

    // Render without focus first, let GeoJSON load
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider>
          <LayersStateProvider>
            <CountyBoundaries
              focusedCounty={null}
              onFocusCounty={onFocusCounty}
              onSelectCounty={onSelectCounty}
            />
          </LayersStateProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(L.geoJSON).toHaveBeenCalled();
    });

    // Now set focusedCounty to trigger the tooltip effect
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider>
          <LayersStateProvider>
            <CountyBoundaries
              focusedCounty="Fresno"
              onFocusCounty={onFocusCounty}
              onSelectCounty={onSelectCounty}
            />
          </LayersStateProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(L.tooltip).toHaveBeenCalled();
    });
  });

  it("renders null (no visible DOM)", () => {
    const { container } = renderComponent();
    expect(container.innerHTML).toBe("");
  });

  it("registers a moveend listener", async () => {
    renderComponent();
    await waitFor(() => expect(L.geoJSON).toHaveBeenCalled());
    expect(mockMapInstance.on).toHaveBeenCalledWith("moveend", expect.any(Function));
  });

  it("paints counties via setStyle after data loads", async () => {
    renderComponent();
    await waitFor(() => {
      const totalCalls =
        featureLayerMocks[0].setStyle.mock.calls.length +
        featureLayerMocks[1].setStyle.mock.calls.length;
      expect(totalCalls).toBeGreaterThan(0);
    });
  });
});
