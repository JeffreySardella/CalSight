import { useEffect, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import L from "leaflet";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));
vi.mock("../../config", () => ({ API_BASE: "", WATER_PAGE_PUBLIC: true }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import TractBurdenLayer from "./TractBurdenLayer";
import { cesHighlightColor, noDataFill } from "../../lib/map/tractBurden";
import { PALETTES } from "../../lib/choropleth/palettes";

const BURDEN = {
  summary: {
    coord_share: 0.42,
    tract_count: 3,
    start_year: null,
    end_year: null,
    population_available: true,
    tracts_without_population: 1,
  },
  tracts: [
    // Los Angeles (county_code 19), top CES quartile, has a rate.
    { geoid: "06037100100", county_code: 19, ces_percentile: 88, crash_count: 40, killed: 3, injured: 10, crashes_per_1k_pop: 10 },
    { geoid: "06037100200", county_code: 19, ces_percentile: 15, crash_count: 5, killed: 0, injured: 1, crashes_per_1k_pop: 2.5 },
    // No CES population — rate is null while the ramp IS a rate.
    { geoid: "06059010100", county_code: 30, ces_percentile: 50, crash_count: 7, killed: 1, injured: 2, crashes_per_1k_pop: null },
  ],
};

const TRACT_TOPO = {
  type: "Topology",
  objects: { tracts: { type: "GeometryCollection", geometries: [] } },
  arcs: [],
};

const COUNTY_TOPO = {
  type: "Topology",
  objects: { counties: { type: "GeometryCollection", geometries: [] } },
  arcs: [],
};

// topojson-client's `feature()` is real; stub it so the test controls the
// FeatureCollection both hooks hand back.
vi.mock("topojson-client", () => ({
  feature: (topology: { objects: Record<string, unknown> }) =>
    topology.objects.counties
      ? {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: { name: "Los Angeles", county_code: 19 }, geometry: {} },
            { type: "Feature", properties: { name: "Orange", county_code: 30 }, geometry: {} },
          ],
        }
      : {
          type: "FeatureCollection",
          features: BURDEN.tracts.map((t) => ({
            type: "Feature",
            id: t.geoid,
            properties: {},
            geometry: { type: "Polygon", coordinates: [] },
          })),
        },
}));

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
  useEffect(() => setOtherLayer("tractBurden", true), [setOtherLayer]);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/tract-burden")) {
      return { ok: true, status: 200, json: async () => BURDEN } as Response;
    }
    if (url.includes("ca-tracts.topo.json")) {
      return { ok: true, status: 200, json: async () => TRACT_TOPO } as Response;
    }
    if (url.includes("ca-counties.topo.json")) {
      return { ok: true, status: 200, json: async () => COUNTY_TOPO } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The options object the component handed to L.geoJSON. */
type GeoJsonOpts = {
  style: (f: unknown) => Record<string, unknown>;
  onEachFeature: (f: unknown, layer: { bindTooltip: unknown; on: unknown }) => void;
};

async function renderLayer(props: Record<string, unknown> = {}) {
  render(
    <Providers>
      <EnableLayer />
      <TractBurdenLayer {...props} />
    </Providers>,
  );
  await waitFor(() => expect(L.geoJSON).toHaveBeenCalled());
  const calls = (L.geoJSON as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[calls.length - 1][1] as GeoJsonOpts;
}

function featureFor(geoid: string) {
  return { type: "Feature", id: geoid, properties: {}, geometry: {} };
}

function fakeFeatureLayer() {
  const handlers: Record<string, () => void> = {};
  return {
    handlers,
    bindTooltip: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
  };
}

describe("TractBurdenLayer", () => {
  it("does not fetch while the layer is off", () => {
    render(
      <Providers>
        <TractBurdenLayer />
      </Providers>,
    );
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(urls.filter((u) => u.includes("tract"))).toEqual([]);
  });

  it("forwards a tract click to the county drill-down handlers", async () => {
    const onFocusCounty = vi.fn();
    const onSelectCounty = vi.fn();
    const opts = await renderLayer({ onFocusCounty, onSelectCounty });

    const layer = fakeFeatureLayer();
    opts.onEachFeature(featureFor("06037100100"), layer);
    expect(layer.handlers.click).toBeTypeOf("function");

    layer.handlers.click();
    // county_code 19 resolves to the county NAME the handlers take.
    expect(onFocusCounty).toHaveBeenCalledWith("Los Angeles");
    expect(onSelectCounty).toHaveBeenCalledWith("Los Angeles");
  });

  it("forwards the clicked tract's own county, not the first one", async () => {
    const onSelectCounty = vi.fn();
    const opts = await renderLayer({ onSelectCounty });

    const layer = fakeFeatureLayer();
    opts.onEachFeature(featureFor("06059010100"), layer);
    layer.handlers.click();

    expect(onSelectCounty).toHaveBeenCalledWith("Orange");
  });

  it("sits above the county pane so its own clicks and tooltips resolve", async () => {
    await renderLayer();
    const pane = (L as unknown as { canvas: { mock: { calls: unknown[][] } } }).canvas.mock.calls[0][0];
    expect(pane).toEqual({ pane: "tractBurdenPane" });
  });

  it("outlines the top CES quartile in a colour that is in no palette ramp", async () => {
    const opts = await renderLayer();
    const burdened = opts.style(featureFor("06037100100"));
    const ordinary = opts.style(featureFor("06037100200"));

    expect(burdened.color).toBe(cesHighlightColor(false));
    expect(burdened.weight).toBe(1);
    expect(ordinary.weight).toBe(0);

    // Regression guard for the amber that WAS the warm ramp's middle step.
    const everyRampColor = Object.values(PALETTES).flatMap((p) => [...p.light, ...p.dark]);
    expect(everyRampColor).not.toContain(cesHighlightColor(false));
    expect(everyRampColor).not.toContain(cesHighlightColor(true));
  });

  it("gives a tract with no population a visible no-data fill, not a hole", async () => {
    const opts = await renderLayer();
    const style = opts.style(featureFor("06059010100"));

    expect(style.fillColor).toBe(noDataFill(false));
    expect(style.fillOpacity).toBeGreaterThan(0);
  });

  it("labels the units in the tooltip when a tract falls back to counts", async () => {
    const opts = await renderLayer();

    const rated = fakeFeatureLayer();
    opts.onEachFeature(featureFor("06037100100"), rated);
    expect(rated.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("per 1,000 residents"),
      expect.anything(),
    );

    const counted = fakeFeatureLayer();
    opts.onEachFeature(featureFor("06059010100"), counted);
    const html = (counted.bindTooltip as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(html).toContain("7 crashes (no population figure)");
    expect(html).not.toContain("per 1,000 residents");
  });
});
