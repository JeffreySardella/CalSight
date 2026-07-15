import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import DroughtSection, { SeverityBar } from "./DroughtSection";
import type { DroughtSnapshot } from "../../hooks/useDroughtData";

const SNAPSHOT: DroughtSnapshot = {
  week_start: "2026-06-30",
  statewide: {
    none_pct: 40.0,
    d0_pct: 20.0,
    d1_pct: 25.0,
    d2_pct: 10.0,
    d3_pct: 5.0,
    d4_pct: 0.0,
  },
  counties: [
    // Kern: deep drought — must rank first (highest D2+).
    { county_code: 15, none_pct: 0, d0_pct: 0, d1_pct: 20, d2_pct: 50, d3_pct: 30, d4_pct: 0 },
    // Sacramento: moderate drought only.
    { county_code: 34, none_pct: 20, d0_pct: 30, d1_pct: 50, d2_pct: 0, d3_pct: 0, d4_pct: 0 },
    // Alameda: clear — must not appear in the hardest-hit list.
    { county_code: 1, none_pct: 100, d0_pct: 0, d1_pct: 0, d2_pct: 0, d3_pct: 0, d4_pct: 0 },
  ],
};

// County names come from the topojson (single source shared with the map),
// so the mock topology below carries all three counties.

function mockApi(snapshot: DroughtSnapshot | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/water/drought/series")) {
      const series =
        snapshot === null
          ? []
          : [
              { ...SNAPSHOT.statewide, week_start: "2026-06-23", d1_pct: 10 },
              { ...SNAPSHOT.statewide, week_start: "2026-06-30" },
            ];
      return new Response(JSON.stringify(series), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/water/drought")) {
      if (snapshot === null) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(snapshot), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("ca-counties.topo.json")) {
      // Minimal topology so the choropleth renders and names resolve.
      return new Response(
        JSON.stringify({
          type: "Topology",
          objects: {
            counties: {
              type: "GeometryCollection",
              geometries: [
                {
                  type: "Polygon",
                  arcs: [[0]],
                  properties: { name: "Kern", county_code: 15, fips: "06029" },
                },
                {
                  type: "Polygon",
                  arcs: [[0]],
                  properties: { name: "Sacramento", county_code: 34, fips: "06067" },
                },
                {
                  type: "Polygon",
                  arcs: [[0]],
                  properties: { name: "Alameda", county_code: 1, fips: "06001" },
                },
              ],
            },
          },
          arcs: [[[-119, 35], [-118, 35], [-118, 36], [-119, 35]]],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<DroughtSection />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DroughtSection", () => {
  it("headlines the statewide D1+ percentage", async () => {
    mockApi(SNAPSHOT);
    renderSection();
    // 25 + 10 + 5 + 0 = 40% in drought
    expect(
      await screen.findByRole("heading", { name: /40% of California is in drought/ }),
    ).toBeInTheDocument();
  });

  it("mentions the D0 abnormally-dry share separately", async () => {
    mockApi(SNAPSHOT);
    renderSection();
    expect(
      await screen.findByText(/A further 20% is abnormally dry/),
    ).toBeInTheDocument();
  });

  it("shows a legend entry with a value for every class", async () => {
    mockApi(SNAPSHOT);
    renderSection();
    await screen.findByRole("heading", { name: /in drought/ });
    const legend = screen.getByRole("list", { name: /severity legend/i });
    for (const label of ["No drought", "D0", "D1", "D2", "D3", "D4"]) {
      expect(legend).toHaveTextContent(label);
    }
    expect(legend).toHaveTextContent("25%"); // D1 value rendered as text
  });

  it("ranks hardest-hit counties by severe share and names them", async () => {
    mockApi(SNAPSHOT);
    renderSection();
    const list = (await screen.findByText("Kern")).closest("ul")!;
    const names = Array.from(list.querySelectorAll("li > span:first-child")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["Kern", "Sacramento"]); // Alameda (clear) excluded
  });

  it("renders the county choropleth map", async () => {
    mockApi(SNAPSHOT);
    renderSection();
    expect(
      await screen.findByRole("img", { name: /map of california counties/i }),
    ).toBeInTheDocument();
  });

  it("plots the statewide trend sparkline from the series", async () => {
    mockApi(SNAPSHOT);
    renderSection();
    expect(
      await screen.findByLabelText(/in drought over the past 2 weeks/),
    ).toBeInTheDocument();
  });

  it("renders nothing when no drought data is loaded", async () => {
    mockApi(null);
    const { container } = renderSection();
    // Give the query a beat to settle, then expect an empty render.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });

  it("shows an error state instead of vanishing when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent(/drought/i);
  });

  it("celebrates a drought-free week instead of showing 0%", async () => {
    mockApi({
      ...SNAPSHOT,
      statewide: { none_pct: 90, d0_pct: 10, d1_pct: 0, d2_pct: 0, d3_pct: 0, d4_pct: 0 },
      counties: [],
    });
    renderSection();
    expect(
      await screen.findByRole("heading", { name: /drought-free/ }),
    ).toBeInTheDocument();
  });
});

describe("SeverityBar", () => {
  it("is one labeled image with a segment per non-trivial class", () => {
    render(
      <SeverityBar
        pcts={{ none_pct: 50, d0_pct: 0.2, d1_pct: 49.8, d2_pct: 0, d3_pct: 0, d4_pct: 0 }}
        label="Test county"
      />,
    );
    const img = screen.getByRole("img", { name: /Test county/ });
    // 0.2% and the zero classes are dropped; 2 segments remain.
    expect(img.children).toHaveLength(2);
  });

  it("describes the composition for screen readers", () => {
    render(
      <SeverityBar
        pcts={{ none_pct: 60, d0_pct: 0, d1_pct: 40, d2_pct: 0, d3_pct: 0, d4_pct: 0 }}
        label="Statewide"
      />,
    );
    expect(
      screen.getByRole("img", { name: /No drought: 60%.*D1 Moderate: 40%/ }),
    ).toBeInTheDocument();
  });
});
