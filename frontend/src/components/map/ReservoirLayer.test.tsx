import { useEffect, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));
// The layer is soft-launch-gated; tests exercise it with the flag up and
// verify it stays dark with the flag down. `mockConfig` is mutated per-test.
const mockConfig = vi.hoisted(() => ({ API_BASE: "", WATER_PAGE_PUBLIC: true }));
vi.mock("../../config", () => mockConfig);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import ReservoirLayer from "./ReservoirLayer";
import {
  fillColorFor,
  markerSizePx,
  reservoirIconHtml,
} from "../../lib/map/reservoirMarkers";
import type { ReservoirCondition } from "../../hooks/useWaterData";

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
  useEffect(() => setOtherLayer("reservoirs", true), [setOtherLayer]);
  return null;
}

const RESERVOIRS: ReservoirCondition[] = [
  {
    station_id: "SHA", name: "Shasta Lake", capacity_af: 4_552_000, county_code: 45,
    lat: 40.718, lon: -122.42, latest_date: "2026-07-14", storage_af: 3_414_000,
    pct_of_capacity: 75.0, avg_storage_af: 3_100_000, pct_of_average: 110.1,
  },
  {
    station_id: "PYM", name: "Pyramid Lake", capacity_af: 180_000, county_code: 19,
    lat: 34.644153, lon: -118.764528, latest_date: "2026-07-14", storage_af: 63_000,
    pct_of_capacity: 35.0, avg_storage_af: null, pct_of_average: null,
  },
  {
    // No coordinates (row loaded before the lat/lon columns) — must be skipped.
    station_id: "OLD", name: "Legacy Lake", capacity_af: 500_000, county_code: 1,
    lat: null, lon: null, latest_date: "2026-07-14", storage_af: 250_000,
    pct_of_capacity: 50.0, avg_storage_af: null, pct_of_average: null,
  },
];

beforeEach(() => {
  mockConfig.WATER_PAGE_PUBLIC = true;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/water/reservoirs")) {
      return { ok: true, json: async () => RESERVOIRS } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReservoirLayer", () => {
  it("does not fetch when the layer is off (default)", async () => {
    render(
      <Providers>
        <ReservoirLayer />
      </Providers>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("stays dark while WATER_PAGE_PUBLIC is false, even with the layer on", async () => {
    mockConfig.WATER_PAGE_PUBLIC = false;
    render(
      <Providers>
        <EnableLayer />
        <ReservoirLayer />
      </Providers>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("marker")).toHaveLength(0);
  });

  it("draws a marker per reservoir with coordinates, skipping legacy rows", async () => {
    render(
      <Providers>
        <EnableLayer />
        <ReservoirLayer />
      </Providers>,
    );
    await waitFor(() => expect(screen.getAllByTestId("marker")).toHaveLength(2));
    const positions = screen
      .getAllByTestId("marker")
      .map((m) => JSON.parse(m.getAttribute("data-position") ?? "[]"));
    expect(positions).toContainEqual([40.718, -122.42]);
    expect(positions).toContainEqual([34.644153, -118.764528]);
  });

  it("annotates markers with the percent of capacity and sizes by capacity", async () => {
    render(
      <Providers>
        <EnableLayer />
        <ReservoirLayer />
      </Providers>,
    );
    await waitFor(() => expect(screen.getAllByTestId("marker")).toHaveLength(2));
    const htmlOf = (station: string) =>
      screen
        .getAllByTestId("marker")
        .map((m) => m.getAttribute("data-icon-html") ?? "")
        .find((h) => h.includes(station === "SHA" ? "Shasta" : "Pyramid"))!;
    const sha = htmlOf("SHA");
    const pym = htmlOf("PYM");
    expect(sha).toContain("Shasta Lake: 75% of capacity");
    expect(sha).toContain(">75<");
    expect(pym).toContain(">35<");
    // Shasta (25× the capacity) draws at the max size; Pyramid much smaller.
    const width = (h: string) => Number(h.match(/width="(\d+)"/)?.[1]);
    expect(width(sha)).toBeGreaterThan(width(pym));
  });

  it("popup carries the storage details and a link to /water", async () => {
    render(
      <Providers>
        <EnableLayer />
        <ReservoirLayer />
      </Providers>,
    );
    await waitFor(() => expect(screen.getAllByTestId("popup")).toHaveLength(2));
    expect(screen.getByText("Shasta Lake")).toBeInTheDocument();
    expect(screen.getByText(/75% of capacity — 3\.41M of 4\.55M acre-feet/)).toBeInTheDocument();
    expect(screen.getByText(/110% of average for today/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /water conditions/i });
    expect(links[0]).toHaveAttribute("href", "/water");
  });
});

describe("marker helpers", () => {
  it("scales diameter by square root of capacity within bounds", () => {
    expect(markerSizePx(4_552_000, 4_552_000)).toBe(46);
    expect(markerSizePx(0, 4_552_000)).toBe(26);
    const mid = markerSizePx(1_138_000, 4_552_000); // quarter capacity → half ramp
    expect(mid).toBe(36);
  });

  it("steps fill color by percent of capacity", () => {
    expect(fillColorFor(20)).toBe("#d97706");
    expect(fillColorFor(55)).toBe("#38bdf8");
    expect(fillColorFor(90)).toBe("#1d4ed8");
  });

  it("clamps the water level into the gauge for out-of-range percents", () => {
    const base = { ...RESERVOIRS[0] };
    const over = reservoirIconHtml({ ...base, pct_of_capacity: 130 }, 40);
    // Fill rect never exceeds the 36px gauge (y stays at the top: 38-36=2).
    expect(over).toContain('y="2.0"');
    expect(over).toContain(">130<"); // the honest number still prints
    const empty = reservoirIconHtml({ ...base, pct_of_capacity: 0 }, 40);
    expect(empty).toContain('height="0.0"');
  });
});
