import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import DroughtMap, { fillForDroughtShare } from "./DroughtMap";
import type { DroughtCounty } from "../../hooks/useDroughtData";

// Minimal non-quantized topology: two triangular "counties".
const TOPO = {
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
          arcs: [[1]],
          properties: { name: "Alameda", county_code: 1, fips: "06001" },
        },
      ],
    },
  },
  arcs: [
    [[-119, 35], [-118, 35], [-118, 36], [-119, 35]],
    [[-122, 37], [-121, 37], [-121, 38], [-122, 37]],
  ],
};

const COUNTIES: DroughtCounty[] = [
  { county_code: 15, none_pct: 0, d0_pct: 10, d1_pct: 10, d2_pct: 40, d3_pct: 30, d4_pct: 10 }, // 90% D1+
  { county_code: 1, none_pct: 100, d0_pct: 0, d1_pct: 0, d2_pct: 0, d3_pct: 0, d4_pct: 0 },
];

function renderMap(counties: DroughtCounty[] = COUNTIES) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("ca-counties.topo.json")) {
      return new Response(JSON.stringify(TOPO), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<DroughtMap counties={counties} weekStart="2026-06-30" />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DroughtMap", () => {
  it("renders one path per county with severity-binned fills", async () => {
    renderMap();
    const svg = await screen.findByRole("img", { name: /map of california/i });
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    const fills = [...paths].map((p) => p.getAttribute("fill"));
    expect(fills).toContain("rgb(var(--drought-d4))"); // Kern at 90%
    expect(fills).toContain("rgb(var(--surface-container-highest))"); // Alameda clear
  });

  it("gives each county a hoverable title with its drought share", async () => {
    renderMap();
    const svg = await screen.findByRole("img", { name: /map of california/i });
    const titles = [...svg.querySelectorAll("title")].map((t) => t.textContent);
    expect(titles).toContain("Kern — 90% in drought (D1+)");
    expect(titles).toContain("Alameda — no drought");
  });

  it("marks counties missing from the snapshot as no data", async () => {
    renderMap([COUNTIES[0]]); // no Alameda row
    const svg = await screen.findByRole("img", { name: /map of california/i });
    const titles = [...svg.querySelectorAll("title")].map((t) => t.textContent);
    expect(titles).toContain("Alameda — no data");
  });

  it("shows a legend with every bin labeled", async () => {
    renderMap();
    const legend = await screen.findByRole("list", { name: /map legend/i });
    for (const label of ["None", "<20%", "20–40%", "40–60%", "60–80%", "80%+"]) {
      expect(legend).toHaveTextContent(label);
    }
  });
});

describe("fillForDroughtShare", () => {
  it("uses the neutral fill below the 0.5% noise floor", () => {
    expect(fillForDroughtShare(0)).toBe("rgb(var(--surface-container-highest))");
    expect(fillForDroughtShare(0.4)).toBe("rgb(var(--surface-container-highest))");
  });

  it("bins the ramp light to dark by share", () => {
    expect(fillForDroughtShare(5)).toBe("rgb(var(--drought-d0))");
    expect(fillForDroughtShare(25)).toBe("rgb(var(--drought-d1))");
    expect(fillForDroughtShare(45)).toBe("rgb(var(--drought-d2))");
    expect(fillForDroughtShare(70)).toBe("rgb(var(--drought-d3))");
    expect(fillForDroughtShare(95)).toBe("rgb(var(--drought-d4))");
  });

  it("includes exact bin edges in the darker bin", () => {
    expect(fillForDroughtShare(20)).toBe("rgb(var(--drought-d1))");
    expect(fillForDroughtShare(80)).toBe("rgb(var(--drought-d4))");
  });
});
