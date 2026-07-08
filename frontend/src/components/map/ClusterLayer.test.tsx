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
import ClusterLayer from "./ClusterLayer";
import type { ClusterPoint } from "../../hooks/useClusterHotspots";

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

function EnableClusterLayer() {
  const { setOtherLayer } = useLayersState();
  useEffect(() => setOtherLayer("crashClusters", true), [setOtherLayer]);
  return null;
}

const CLUSTERS: ClusterPoint[] = [
  { lat: 34.2, lng: -118.2, crash_count: 8, z_score: 3.1, severity: { fatal: 3, injury: 5, pdo: 0 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  circleMarkerInstances.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/crashes/clusters")) {
      return {
        ok: true,
        json: async () => ({
          clusters: CLUSTERS,
          total_grid_cells: 5,
          mean_count: 1,
          stddev_count: 2.5,
          threshold: 6,
        }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
});

describe("ClusterLayer", () => {
  it("does not fetch or draw markers when the layer is off (default)", async () => {
    render(
      <Providers>
        <ClusterLayer onSelectCluster={() => {}} />
      </Providers>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(L.circleMarker).not.toHaveBeenCalled();
  });

  it("draws one pulsing marker per cluster when enabled", async () => {
    render(
      <Providers>
        <EnableClusterLayer />
        <ClusterLayer onSelectCluster={() => {}} />
      </Providers>,
    );
    await waitFor(() => expect(circleMarkerInstances.length).toBe(1));
    expect(circleMarkerInstances[0].latlng).toEqual([34.2, -118.2]);
    expect(circleMarkerInstances[0].opts.className).toBe("cluster-pulse-marker");
  });

  it("omits involvement flags from the request when their toggles are off (default)", async () => {
    render(
      <Providers>
        <EnableClusterLayer />
        <ClusterLayer onSelectCluster={() => {}} />
      </Providers>,
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    // A default (off) toggle must NOT serialize `flag=false` — that would make
    // the backend apply IS FALSE and drop pre-2016 SWITRS + flag-positive rows.
    for (const flag of ["alcohol", "distracted", "pedestrian", "cyclist", "drug"]) {
      expect(url).not.toContain(`${flag}=false`);
      expect(url).not.toContain(`${flag}=`);
    }
  });

  it("invokes onSelectCluster with the cluster's stats when its marker is clicked", async () => {
    const onSelectCluster = vi.fn();
    render(
      <Providers>
        <EnableClusterLayer />
        <ClusterLayer onSelectCluster={onSelectCluster} />
      </Providers>,
    );
    await waitFor(() => expect(circleMarkerInstances.length).toBe(1));
    const clickHandler = circleMarkerInstances[0].on.mock.calls.find(([event]) => event === "click")?.[1] as () => void;
    clickHandler();
    expect(onSelectCluster).toHaveBeenCalledWith(CLUSTERS[0]);
  });
});
