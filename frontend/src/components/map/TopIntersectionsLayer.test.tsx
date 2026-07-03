import { useEffect, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import L from "leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));

import { circleMarkerInstances } from "../../__mocks__/leaflet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import { MemoryRouter } from "react-router-dom";
import TopIntersectionsLayer from "./TopIntersectionsLayer";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <ThemeProvider>
        <CustomThemeProvider>
          <QueryClientProvider client={qc}>
            <LayersStateProvider>{children}</LayersStateProvider>
          </QueryClientProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function EnableLayer() {
  const { setOtherLayer } = useLayersState();
  useEffect(() => setOtherLayer("topIntersections", true), [setOtherLayer]);
  return null;
}

const ROWS = [
  {
    county_code: 19, county_name: "Fresno", primary_road: "MAIN ST", secondary_road: "1ST AVE",
    crash_count: 42, fatal_count: 2, injury_count: 30, pdo_count: 10, severity_score: 500,
    killed: 3, injured: 40, latitude: 36.7, longitude: -119.8,
  },
  {
    county_code: 19, county_name: "Fresno", primary_road: "OAK ST", secondary_road: "2ND AVE",
    crash_count: 20, fatal_count: 0, injury_count: 12, pdo_count: 8, severity_score: 128,
    killed: 0, injured: 15, latitude: 36.75, longitude: -119.7,
  },
  {
    // Null coords — must be skipped for markers.
    county_code: 19, county_name: "Fresno", primary_road: "ELM ST", secondary_road: "3RD AVE",
    crash_count: 15, fatal_count: 1, injury_count: 5, pdo_count: 9, severity_score: 159,
    killed: 1, injured: 6, latitude: null, longitude: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  circleMarkerInstances.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/intersections")) {
      return { ok: true, json: async () => ROWS } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
});

describe("TopIntersectionsLayer", () => {
  it("does not fetch or draw markers when the layer is off (default)", async () => {
    render(
      <Providers>
        <TopIntersectionsLayer county={null} />
      </Providers>,
    );
    // Give any effects a chance to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(L.circleMarker).not.toHaveBeenCalled();
  });

  it("draws one marker per row with coordinates and skips null-coord rows", async () => {
    render(
      <Providers>
        <EnableLayer />
        <TopIntersectionsLayer county={null} />
      </Providers>,
    );
    // Two of the three rows have coordinates.
    await waitFor(() => expect(circleMarkerInstances.length).toBe(2));
    expect(circleMarkerInstances[0].latlng).toEqual([36.7, -119.8]);
    expect(circleMarkerInstances[1].latlng).toEqual([36.75, -119.7]);
  });

  it("renders a popup with neutral, factual fields", async () => {
    render(
      <Providers>
        <EnableLayer />
        <TopIntersectionsLayer county={null} />
      </Providers>,
    );
    await waitFor(() => expect(circleMarkerInstances.length).toBe(2));
    const html = circleMarkerInstances[0].bindPopup.mock.calls[0][0] as string;
    expect(html).toContain("MAIN ST & 1ST AVE");
    expect(html).toContain("Crashes: 42");
    expect(html).toContain("Fatal 2 / Injury 30 / PDO 10");
    expect(html).toContain("Severity score: 500");
    // Neutral voice — no charged language.
    expect(html).not.toMatch(/dangerous|deadliest|hotspot|worst/i);
  });
});
