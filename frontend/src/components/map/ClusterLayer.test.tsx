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
  // Layer toggles persist to localStorage ("calsight-layers") — clear so a
  // prior test's EnableClusterLayer doesn't leak into tests expecting the
  // default-off state.
  localStorage.clear();
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

  it("re-syncs the selected cluster's stats when the hotspots (re)load (M18: stale side panel)", async () => {
    // The side panel is open on the cell at (34.2, -118.2) with stats from the
    // old filters; the hotspot list (re)fetches — the panel must receive the
    // cell's fresh stats so its counts/z-score match the active filters.
    const staleSelection: ClusterPoint = {
      lat: 34.2, lng: -118.2, crash_count: 42, z_score: 5.5,
      severity: { fatal: 9, injury: 30, pdo: 3 },
    };
    const onSelectCluster = vi.fn();
    render(
      <Providers>
        <EnableClusterLayer />
        <ClusterLayer onSelectCluster={onSelectCluster} selectedCluster={staleSelection} />
      </Providers>,
    );
    await waitFor(() => expect(onSelectCluster).toHaveBeenCalled());
    expect(onSelectCluster).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 34.2, lng: -118.2, crash_count: 8, z_score: 3.1 }),
    );
  });

  it("signals when the selected cell is no longer a hotspot under the new filters (M18)", async () => {
    const elsewhere: ClusterPoint = {
      lat: 37.7, lng: -122.4, crash_count: 12, z_score: 2.4,
      severity: { fatal: 1, injury: 8, pdo: 3 },
    };
    const onSelectCluster = vi.fn();
    const onSelectedClusterGone = vi.fn();
    render(
      <Providers>
        <EnableClusterLayer />
        <ClusterLayer
          onSelectCluster={onSelectCluster}
          selectedCluster={elsewhere}
          onSelectedClusterGone={onSelectedClusterGone}
        />
      </Providers>,
    );
    await waitFor(() => expect(onSelectedClusterGone).toHaveBeenCalled());
    expect(onSelectCluster).not.toHaveBeenCalled();
  });

  it("signals gone when the layer is toggled off while a cluster panel is open (M18)", async () => {
    // Layer left at its default (off): an open panel must close, not survive
    // with stats for markers that are no longer on the map.
    const onSelectedClusterGone = vi.fn();
    render(
      <Providers>
        <ClusterLayer
          onSelectCluster={() => {}}
          selectedCluster={CLUSTERS[0]}
          onSelectedClusterGone={onSelectedClusterGone}
        />
      </Providers>,
    );
    await waitFor(() => expect(onSelectedClusterGone).toHaveBeenCalled());
    // No fetch happens while the layer is off — closing must not depend on one.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
