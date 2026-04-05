import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import L from "leaflet";
import { geoJSONLayerMock, mockMapInstance } from "../../__mocks__/leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));

import CountyBoundaries from "./CountyBoundaries";

const FAKE_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "Fresno" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    },
    {
      type: "Feature",
      properties: { name: "Alameda" },
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

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve(FAKE_GEOJSON),
      })
    ) as unknown as typeof fetch;
  });

  function renderComponent(focusedCounty: string | null = null) {
    return render(
      <CountyBoundaries
        focusedCounty={focusedCounty}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
      />
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
        feature: { type: "Feature", properties: { name: "Fresno" }, geometry: {} },
        getBounds: () => ({
          getCenter: () => ({ lat: 36.7, lng: -119.8 }),
        }),
      });
    });

    // Render without focus first, let GeoJSON load
    const { rerender } = render(
      <CountyBoundaries
        focusedCounty={null}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
      />
    );
    await waitFor(() => {
      expect(L.geoJSON).toHaveBeenCalled();
    });

    // Now set focusedCounty to trigger the tooltip effect
    rerender(
      <CountyBoundaries
        focusedCounty="Fresno"
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
      />
    );
    await waitFor(() => {
      expect(L.tooltip).toHaveBeenCalled();
    });
  });

  it("renders null (no visible DOM)", () => {
    const { container } = renderComponent();
    expect(container.innerHTML).toBe("");
  });
});
