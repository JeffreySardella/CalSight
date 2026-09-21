import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import DroughtMap, { fillForDroughtShare, fillForReservoirPct } from "./DroughtMap";
import type { DroughtCounty } from "../../hooks/useDroughtData";
import type { ReservoirCondition } from "../../hooks/useWaterData";

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

// Coordinates sit inside the two fixture "counties" above so the shared
// projector places them on the map rather than off-canvas.
const SHASTA: ReservoirCondition = {
  station_id: "SHA",
  name: "Shasta Lake",
  capacity_af: 4_552_000,
  county_code: 45,
  lat: 37.2,
  lon: -121.5,
  latest_date: "2026-07-09",
  storage_af: 3_414_000,
  pct_of_capacity: 75.0,
  avg_storage_af: 3_100_000,
  pct_of_average: 110.1,
};

const FOLSOM: ReservoirCondition = {
  station_id: "FOL",
  name: "Folsom Lake",
  capacity_af: 977_000,
  county_code: 34,
  lat: 35.4,
  lon: -118.6,
  latest_date: "2026-07-09",
  storage_af: 293_100,
  pct_of_capacity: 30.0,
  avg_storage_af: null,
  pct_of_average: null,
};

/** Pre-coordinate row: the layer must skip it, not crash on the nulls. */
const NO_COORDS: ReservoirCondition = {
  ...FOLSOM,
  station_id: "OLD",
  name: "Nameless Lake",
  lat: null,
  lon: null,
};

function renderMap(
  counties: DroughtCounty[] = COUNTIES,
  reservoirs?: ReservoirCondition[],
  onShowInList?: (stationId: string) => void,
) {
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
  return render(
    <DroughtMap
      counties={counties}
      weekStart="2026-06-30"
      reservoirs={reservoirs}
      onShowInList={onShowInList}
    />,
    { wrapper },
  );
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

  it("fills no-data counties with the hatch, not the None color", async () => {
    renderMap([COUNTIES[0]]); // no Alameda row
    const svg = await screen.findByRole("img", { name: /map of california/i });
    const noDataPath = [...svg.querySelectorAll("path")].find((p) =>
      p.querySelector("title")?.textContent?.includes("no data"),
    )!;
    expect(noDataPath.getAttribute("fill")).toBe("url(#drought-no-data)");
    const legend = await screen.findByRole("list", { name: /map legend/i });
    expect(legend).toHaveTextContent("No data");
  });

  it("shows a legend with every bin labeled", async () => {
    renderMap();
    const legend = await screen.findByRole("list", { name: /map legend/i });
    for (const label of ["None", "<20%", "20–40%", "40–60%", "60–80%", "80%+"]) {
      expect(legend).toHaveTextContent(label);
    }
    // Every county has data here — no misleading "No data" legend entry.
    expect(legend).not.toHaveTextContent("No data");
  });
});

describe("DroughtMap reservoir layer", () => {
  /** The transparent hit circles are the only role=button elements until a
   *  panel opens; they carry the labels and the keyboard handling. */
  async function findCircles() {
    await screen.findByRole("img", { name: /map of california/i });
    return screen.getAllByRole("button");
  }

  /** The visible dot behind a hit circle — this is what carries size and
   *  color, in the same big-first draw order. */
  function visibleDots() {
    return [...document.querySelectorAll("[data-testid^='reservoir-dot-']")];
  }

  it("draws no circles when the reservoir query has not resolved", async () => {
    renderMap(COUNTIES, undefined);
    const svg = await screen.findByRole("img", { name: /map of california/i });
    expect(svg.closest("svg")!.querySelectorAll("circle")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    // The choropleth is untouched by the missing layer.
    expect(svg.querySelectorAll("path")).toHaveLength(2);
  });

  it("skips reservoirs with no coordinates", async () => {
    renderMap(COUNTIES, [SHASTA, NO_COORDS]);
    const circles = await findCircles();
    expect(circles).toHaveLength(1);
    expect(circles[0]).toHaveAttribute(
      "aria-label",
      "Shasta Lake, 75% of capacity",
    );
  });

  it("sizes circles by capacity and draws the biggest first", async () => {
    renderMap(COUNTIES, [FOLSOM, SHASTA]);
    const circles = await findCircles();
    const radii = visibleDots().map((c) => Number(c.getAttribute("r")));
    // Shasta (4.55M AF) is the largest, so it is drawn first and Folsom
    // (977K AF) lands on top of it.
    expect(circles[0]).toHaveAttribute("aria-label", expect.stringContaining("Shasta"));
    expect(radii[0]).toBeGreaterThan(radii[1]);
    // Area-proportional: r = 16 * sqrt(977/4552) ≈ 7.4, above the 6px floor.
    expect(radii[0]).toBeCloseTo(16, 5);
    expect(radii[1]).toBeCloseTo(7.41, 1);
  });

  it("keeps a finger-sized hit target under the smallest dot", async () => {
    renderMap(COUNTIES, [FOLSOM, SHASTA]);
    const circles = await findCircles();
    // Folsom's visible dot is ~7.4 units; its hit circle is floored at 15,
    // which is ~24 CSS px once the map shrinks to a 375px phone.
    expect(Number(circles[1].getAttribute("r"))).toBe(15);
    // The big one is already past the floor — no inflation.
    expect(Number(circles[0].getAttribute("r"))).toBeCloseTo(16, 5);
  });

  it("encodes percent of capacity with the blue ramp, not the drought ramp", async () => {
    renderMap(COUNTIES, [FOLSOM, SHASTA]);
    await findCircles();
    const fills = visibleDots().map((c) => c.getAttribute("fill"));
    expect(fills).toEqual([
      "rgb(var(--reservoir-r3))", // Shasta at 75%
      "rgb(var(--reservoir-r1))", // Folsom at 30%
    ]);
  });

  it("selects a reservoir on click and shows its numbers", async () => {
    renderMap(COUNTIES, [SHASTA, FOLSOM]);
    const circles = await findCircles();
    await userEvent.click(circles[0]);

    const panel = screen.getByRole("group", { name: /shasta lake detail/i });
    expect(panel).toHaveTextContent("75");
    expect(panel).toHaveTextContent("3.41M of 4.55M acre-feet");
    expect(panel).toHaveTextContent("2026-07-09");
    expect(panel).toHaveTextContent("110% of average for this date");
    expect(circles[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("omits the average line when the reservoir has no history", async () => {
    renderMap(COUNTIES, [FOLSOM]);
    const circles = await findCircles();
    await userEvent.click(circles[0]);
    const panel = screen.getByRole("group", { name: /folsom lake detail/i });
    expect(panel).not.toHaveTextContent(/of average for this date/);
  });

  it("toggles off on a second tap of the same circle", async () => {
    renderMap(COUNTIES, [SHASTA]);
    const circles = await findCircles();
    await userEvent.click(circles[0]);
    expect(screen.getByRole("group", { name: /shasta lake detail/i })).toBeInTheDocument();
    await userEvent.click(circles[0]);
    expect(screen.queryByRole("group", { name: /shasta lake detail/i })).toBeNull();
    expect(circles[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("activates on Enter and on Space from the keyboard", async () => {
    renderMap(COUNTIES, [SHASTA]);
    const circles = await findCircles();
    circles[0].focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("group", { name: /shasta lake detail/i })).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(screen.queryByRole("group", { name: /shasta lake detail/i })).toBeNull();
  });

  it("clears the selection on Escape", async () => {
    renderMap(COUNTIES, [SHASTA]);
    const circles = await findCircles();
    await userEvent.click(circles[0]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /shasta lake detail/i })).toBeNull();
  });

  it("hands the station id back for Show in list", async () => {
    const onShowInList = vi.fn();
    renderMap(COUNTIES, [SHASTA], onShowInList);
    const circles = await findCircles();
    await userEvent.click(circles[0]);
    await userEvent.click(screen.getByRole("button", { name: /show in list/i }));
    expect(onShowInList).toHaveBeenCalledWith("SHA");
  });

  it("adds a reservoir legend only when circles are drawn", async () => {
    renderMap(COUNTIES, [SHASTA]);
    const legend = await screen.findByRole("list", { name: /legend: reservoirs/i });
    for (const label of ["<25%", "25–50%", "50–75%", "75%+"]) {
      expect(legend).toHaveTextContent(label);
    }
    cleanup();
    renderMap(COUNTIES, undefined);
    await screen.findByRole("img", { name: /map of california/i });
    expect(screen.queryByRole("list", { name: /legend: reservoirs/i })).toBeNull();
  });
});

describe("fillForReservoirPct", () => {
  it("bins fullness pale to deep", () => {
    expect(fillForReservoirPct(0)).toBe("rgb(var(--reservoir-r0))");
    expect(fillForReservoirPct(30)).toBe("rgb(var(--reservoir-r1))");
    expect(fillForReservoirPct(60)).toBe("rgb(var(--reservoir-r2))");
    expect(fillForReservoirPct(90)).toBe("rgb(var(--reservoir-r3))");
  });

  it("puts bin edges in the fuller bin and clamps above capacity", () => {
    expect(fillForReservoirPct(25)).toBe("rgb(var(--reservoir-r1))");
    expect(fillForReservoirPct(75)).toBe("rgb(var(--reservoir-r3))");
    expect(fillForReservoirPct(112)).toBe("rgb(var(--reservoir-r3))");
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
