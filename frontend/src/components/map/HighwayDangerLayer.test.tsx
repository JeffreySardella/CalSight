import { useEffect, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import L from "leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import { MemoryRouter } from "react-router-dom";
import HighwayDangerLayer from "./HighwayDangerLayer";

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

function EnableHighwayLayer() {
  const { setOtherLayer } = useLayersState();
  useEffect(() => setOtherLayer("highwayDanger", true), [setOtherLayer]);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("ca-highways.geojson")) {
      return {
        ok: true,
        json: async () => ({
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: { route_number: "I-5" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
          ],
        }),
      } as Response;
    }
    if (url.includes("/api/stats/highways")) {
      return {
        ok: true,
        json: async () => [
          { route_number: "I-5", crash_count: 100, total_killed: 5, total_injured: 50, fatality_rate: 0.05, miles: 796, crashes_per_mile: 0.13 },
        ],
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
});

describe("HighwayDangerLayer", () => {
  it("does not draw a layer when highwayDanger is off (default)", async () => {
    render(
      <Providers>
        <HighwayDangerLayer onSelectHighway={() => {}} />
      </Providers>,
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(L.geoJSON).not.toHaveBeenCalled();
  });

  it("draws a line layer when highwayDanger is enabled", async () => {
    render(
      <Providers>
        <EnableHighwayLayer />
        <HighwayDangerLayer onSelectHighway={() => {}} />
      </Providers>,
    );
    await waitFor(() => expect(L.geoJSON).toHaveBeenCalled());
  });

  it("re-syncs the selected route's row when rankings load (M-F5: stale side panel)", async () => {
    // The side panel is open on I-5; the rankings (re)fetch — the panel must
    // receive the fresh row so its numbers match the active filters.
    const onSelectHighway = vi.fn();
    render(
      <Providers>
        <EnableHighwayLayer />
        <HighwayDangerLayer onSelectHighway={onSelectHighway} selectedRoute="I-5" />
      </Providers>,
    );
    await waitFor(() => expect(onSelectHighway).toHaveBeenCalled());
    expect(onSelectHighway).toHaveBeenCalledWith(
      expect.objectContaining({ route_number: "I-5", crash_count: 100 }),
    );
  });

  it("signals when the selected route has no row under the new filters", async () => {
    const onSelectHighway = vi.fn();
    const onSelectedRouteGone = vi.fn();
    render(
      <Providers>
        <EnableHighwayLayer />
        <HighwayDangerLayer
          onSelectHighway={onSelectHighway}
          selectedRoute="SR-99"
          onSelectedRouteGone={onSelectedRouteGone}
        />
      </Providers>,
    );
    await waitFor(() => expect(onSelectedRouteGone).toHaveBeenCalled());
    expect(onSelectHighway).not.toHaveBeenCalled();
  });
});
