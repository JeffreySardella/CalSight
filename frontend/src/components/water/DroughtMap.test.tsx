import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import DroughtMap, {
  fillForDroughtShare,
  fillForReservoirPct,
  fillForSnowPct,
} from "./DroughtMap";
import type { DroughtCounty } from "../../hooks/useDroughtData";
import type {
  RegionSnowpack,
  SnowStationCondition,
} from "../../hooks/useSnowpackData";
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

/** Sits almost on top of Shasta and is smaller, so it draws after Shasta
 *  (big-first order) and its hit circle covers Shasta's centre — the exact
 *  live-site overlap (Trinity over Shasta) the nearest-centre rule fixes. */
const TRINITY: ReservoirCondition = {
  station_id: "TRI",
  name: "Trinity Lake",
  capacity_af: 2_448_000,
  county_code: 45,
  lat: 37.2,
  lon: -121.49,
  latest_date: "2026-07-09",
  storage_af: 1_700_000,
  pct_of_capacity: 70.0,
  avg_storage_af: 1_545_000,
  pct_of_average: 110.0,
};

/** Pre-coordinate row: the layer must skip it, not crash on the nulls. */
const NO_COORDS: ReservoirCondition = {
  ...FOLSOM,
  station_id: "OLD",
  name: "Nameless Lake",
  lat: null,
  lon: null,
};

/** Snow stations, positioned inside the fixture "counties" like the
 *  reservoirs above so the shared projector keeps them on canvas. */
const CSL: SnowStationCondition = {
  station_id: "CSL",
  name: "Central Sierra Snow Lab",
  region: "Central Sierra",
  elevation_ft: 6900,
  lat: 37.4,
  lon: -121.4,
  latest_date: "2026-03-01",
  swe_in: 24.6,
  pct_of_average: 112.0,
};

const GIN: SnowStationCondition = {
  station_id: "GIN",
  name: "Gin Flat",
  region: "Southern Sierra",
  elevation_ft: 7050,
  lat: 35.5,
  lon: -118.7,
  latest_date: "2026-03-01",
  swe_in: 6.0,
  pct_of_average: null,
};

/** A second Central Sierra mark, so one region covers more than one
 *  station and the panel's coverage line has something to say. */
const CASTLE: SnowStationCondition = {
  ...CSL,
  station_id: "CAS",
  name: "Castle Peak",
  lat: 37.3,
  lon: -121.3,
  pct_of_average: 40,
};

/** Pre-coordinate row: the layer must skip it, not crash on the nulls. */
const SNOW_NO_COORDS: SnowStationCondition = {
  ...GIN,
  station_id: "ZZZ",
  name: "Nowhere Meadow",
  lat: null,
  lon: null,
};

/** The API's regional figures. The percentages here deliberately differ
 *  from the stations' own values so a test can tell which one the panel
 *  quotes: Central Sierra is 88% here but CSL, one of its stations, reads
 *  112%. `station_count` is how many reported on `latest_date`, which is a
 *  subset of the marks on the map — exactly as the live API behaves. */
const REGIONS: RegionSnowpack[] = [
  {
    region: "Central Sierra",
    station_count: 1,
    latest_date: "2026-03-02",
    swe_in: 24.6,
    avg_swe_in: 28.0,
    pct_of_average: 88,
    apr1_swe_in: null,
    apr1_avg_swe_in: null,
    apr1_pct_of_average: null,
  },
  {
    region: "Southern Sierra",
    station_count: 20,
    latest_date: "2026-03-02",
    swe_in: 6.0,
    avg_swe_in: 12.0,
    pct_of_average: 50,
    apr1_swe_in: null,
    apr1_avg_swe_in: null,
    apr1_pct_of_average: null,
  },
];

function renderMap(
  counties: DroughtCounty[] = COUNTIES,
  reservoirs?: ReservoirCondition[],
  onShowInList?: (stationId: string) => void,
  snowStations?: SnowStationCondition[],
  snowRegions?: RegionSnowpack[],
  onShowRegionInList?: (region: string) => void,
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
      snowStations={snowStations}
      snowRegions={snowRegions}
      onShowInList={onShowInList}
      onShowRegionInList={onShowRegionInList}
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

  it("resolves an overlapping tap to the nearest reservoir centre, not whichever circle is on top", async () => {
    renderMap(COUNTIES, [SHASTA, TRINITY]);
    const circles = await findCircles();
    // Shasta (4.55M AF) is bigger and drawn first; Trinity (2.45M AF) is
    // drawn after and sits on top where their hit circles overlap.
    expect(circles[0]).toHaveAttribute("aria-label", expect.stringContaining("Shasta"));
    expect(circles[1]).toHaveAttribute("aria-label", expect.stringContaining("Trinity"));

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 460, width: 400, height: 460,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    const shastaDot = document.querySelector("[data-testid='reservoir-dot-SHA']")!;
    const shastaCx = Number(shastaDot.getAttribute("cx"));
    const shastaCy = Number(shastaDot.getAttribute("cy"));

    // A click dispatched on Trinity's (topmost) hit circle, landing exactly
    // at Shasta's own centre, must still select Shasta — that's the whole
    // point of resolving by nearest centre instead of DOM/paint order.
    fireEvent.click(circles[1], { clientX: shastaCx, clientY: shastaCy });
    expect(screen.getByRole("group", { name: /shasta lake detail/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /trinity lake detail/i })).toBeNull();
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

describe("DroughtMap snow layer", () => {
  /** One transparent circle per DWR region — the only snow targets. */
  async function findRegionButtons() {
    await screen.findByRole("img", { name: /map of california/i });
    return screen.getAllByRole("button", { name: /snowpack,/i });
  }

  function snowMarks() {
    return [...document.querySelectorAll("[data-testid^='snow-mark-']")];
  }

  /** jsdom gives every element a zero-sized box, so the client→viewBox
   *  math behind the nearest-station rule needs a stand-in for the real
   *  one. 400 wide = the viewBox width, so client and SVG units line up. */
  function mockSvgBox() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 460, width: 400, height: 460,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  }

  /** Where a station's diamond actually landed, read back off the mark:
   *  points are "cx,cy-r cx+r,cy cx,cy+r cx-r,cy". */
  function markCenter(stationId: string): [number, number] {
    const pts = document
      .querySelector(`[data-testid='snow-mark-${stationId}']`)!
      .getAttribute("points")!
      .split(" ")
      .map((p) => p.split(",").map(Number));
    return [pts[0][0], pts[1][1]];
  }

  it("draws nothing when the snowpack query has not resolved", async () => {
    renderMap(COUNTIES, undefined, undefined, undefined);
    const svg = await screen.findByRole("img", { name: /map of california/i });
    expect(snowMarks()).toHaveLength(0);
    expect(svg.closest("svg")!.querySelectorAll("polygon")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    // The choropleth is untouched by the missing layer.
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(screen.queryByRole("list", { name: /legend: snow stations/i })).toBeNull();
  });

  it("offers one button per region and none per station", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL, GIN, SNOW_NO_COORDS], REGIONS);
    const buttons = await findRegionButtons();
    // Two located stations in two regions — two targets, not 107.
    expect(buttons).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    // The coordinate-less station is skipped, as before.
    expect(snowMarks().map((m) => m.getAttribute("data-testid"))).toEqual([
      "snow-mark-CSL",
      "snow-mark-GIN",
    ]);
    // No station mark is focusable or exposed as a control.
    for (const mark of snowMarks()) {
      expect(mark.closest("[aria-hidden='true']")).not.toBeNull();
      expect(mark.getAttribute("role")).toBeNull();
      expect(mark.getAttribute("tabindex")).toBeNull();
    }
  });

  it("labels a region with the API percent and its mark count", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL, CASTLE, GIN], REGIONS);
    const buttons = await findRegionButtons();
    // 88% is the API's regional figure; CSL reads 112% and Castle 40%.
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining([
        "Central Sierra snowpack, 88% of average, 2 stations",
        "Southern Sierra snowpack, 50% of average, 1 station",
      ]),
    );
  });

  it("uses diamonds and the snow ramp, not the reservoir circles", async () => {
    renderMap(COUNTIES, [SHASTA], undefined, [CSL, GIN], REGIONS);
    await screen.findByRole("img", { name: /map of california/i });
    const marks = snowMarks();
    // Diamond marks are polygons, so shape distinguishes them from the
    // reservoir circles even before color.
    expect(marks.every((m) => m.tagName.toLowerCase() === "polygon")).toBe(true);
    expect(marks.map((m) => m.getAttribute("fill"))).toEqual([
      "rgb(var(--snow-s2))", // CSL at 112%
      "rgb(var(--surface-container-highest))", // GIN has no percent
    ]);
  });

  it("selects the region of the station nearest a tap on the map", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL, GIN], REGIONS);
    const svg = (await screen.findByRole("img", { name: /map of california/i }))
      .closest("svg")!;
    mockSvgBox();

    // A few units off Gin Flat picks Southern Sierra, not the nearer-to-
    // nothing default and not Central Sierra.
    const [gx, gy] = markCenter("GIN");
    fireEvent.click(svg, { clientX: gx + 4, clientY: gy - 3 });
    expect(
      screen.getByRole("group", { name: /southern sierra detail/i }),
    ).toBeInTheDocument();

    // ... and a tap by the other cluster switches regions.
    const [cx, cy] = markCenter("CSL");
    fireEvent.click(svg, { clientX: cx - 2, clientY: cy + 2 });
    expect(
      screen.getByRole("group", { name: /central sierra detail/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /southern sierra detail/i })).toBeNull();

    // Tapping the same cluster again clears it.
    fireEvent.click(svg, { clientX: cx, clientY: cy });
    expect(screen.queryByRole("group", { name: /central sierra detail/i })).toBeNull();
  });

  it("ignores a tap on bare map, far from every station", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL], REGIONS);
    const svg = (await screen.findByRole("img", { name: /map of california/i }))
      .closest("svg")!;
    mockSvgBox();
    const [cx, cy] = markCenter("CSL");
    fireEvent.click(svg, { clientX: cx + 120, clientY: cy + 120 });
    expect(screen.queryByRole("group", { name: /detail/i })).toBeNull();
  });

  it("shows the API region figure, station coverage and reading date", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL, CASTLE], REGIONS);
    const buttons = await findRegionButtons();
    await userEvent.click(buttons[0]);

    const panel = screen.getByRole("group", { name: /central sierra detail/i });
    expect(panel).toHaveTextContent("88");
    expect(panel).toHaveTextContent("% of average");
    // Never the stations' own 112% / 40%.
    expect(panel).not.toHaveTextContent("112");
    // Only one of the two mapped stations reported on the latest date.
    expect(panel).toHaveTextContent("1 of 2 stations reporting");
    expect(panel).toHaveTextContent("2026-03-02");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("says so rather than inventing a percent with no API region row", async () => {
    renderMap(COUNTIES, undefined, undefined, [GIN], undefined);
    const buttons = await findRegionButtons();
    expect(buttons[0]).toHaveAttribute(
      "aria-label",
      "Southern Sierra snowpack, no comparison available, 1 station",
    );
    await userEvent.click(buttons[0]);
    const panel = screen.getByRole("group", { name: /southern sierra detail/i });
    expect(panel).toHaveTextContent(/no percent of average available/i);
    expect(panel).toHaveTextContent("1 of 1 stations reporting");
  });

  it("draws the selected region's stations with a heavier stroke", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL, GIN], REGIONS);
    const buttons = await findRegionButtons();
    const strokes = () =>
      snowMarks().map((m) => Number(m.getAttribute("stroke-width")));
    expect(strokes()).toEqual([1, 1]);
    await userEvent.click(
      buttons.find((b) => b.getAttribute("aria-label")!.startsWith("Central"))!,
    );
    expect(strokes()).toEqual([2.5, 1]); // CSL is the Central Sierra mark
  });

  it("activates on Enter and on Space from the keyboard", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL], REGIONS);
    const buttons = await findRegionButtons();
    buttons[0].focus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getByRole("group", { name: /central sierra detail/i }),
    ).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(screen.queryByRole("group", { name: /central sierra detail/i })).toBeNull();
  });

  it("clears the selection on Escape and on Close", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL], REGIONS);
    const buttons = await findRegionButtons();
    await userEvent.click(buttons[0]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /central sierra detail/i })).toBeNull();

    await userEvent.click(buttons[0]);
    await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("group", { name: /central sierra detail/i })).toBeNull();
  });

  it("keeps one selection across the two layers", async () => {
    renderMap(COUNTIES, [SHASTA], undefined, [CSL], REGIONS);
    await screen.findByRole("img", { name: /map of california/i });
    const reservoir = screen.getByRole("button", { name: /shasta lake, 75%/i });
    const region = screen.getByRole("button", { name: /central sierra snowpack/i });

    await userEvent.click(reservoir);
    expect(screen.getByRole("group", { name: /shasta lake detail/i })).toBeInTheDocument();

    // Selecting the region replaces the reservoir selection.
    await userEvent.click(region);
    expect(
      screen.getByRole("group", { name: /central sierra detail/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /shasta lake detail/i })).toBeNull();
    expect(reservoir).toHaveAttribute("aria-pressed", "false");

    // ... and back the other way.
    await userEvent.click(reservoir);
    expect(screen.getByRole("group", { name: /shasta lake detail/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /central sierra detail/i })).toBeNull();
    expect(region).toHaveAttribute("aria-pressed", "false");
  });

  it("hands the region name back for Show in list", async () => {
    const onShowRegionInList = vi.fn();
    renderMap(
      COUNTIES, undefined, undefined, [CSL], REGIONS, onShowRegionInList,
    );
    const buttons = await findRegionButtons();
    await userEvent.click(buttons[0]);
    await userEvent.click(screen.getByRole("button", { name: /show in list/i }));
    expect(onShowRegionInList).toHaveBeenCalledWith("Central Sierra");
  });

  it("adds a snow legend only when marks are drawn", async () => {
    renderMap(COUNTIES, undefined, undefined, [CSL, GIN], REGIONS);
    const legend = await screen.findByRole("list", { name: /legend: snow stations/i });
    for (const label of ["<50%", "50–100%", "100–150%", "150%+", "No average"]) {
      expect(legend).toHaveTextContent(label);
    }
    // The caption points at the cluster, not at individual stations.
    expect(legend.parentElement).toHaveTextContent(
      "Snow stations · colour = % of average · tap a cluster for its region",
    );
    cleanup();
    renderMap(COUNTIES, [SHASTA], undefined, undefined);
    await screen.findByRole("img", { name: /map of california/i });
    expect(screen.queryByRole("list", { name: /legend: snow stations/i })).toBeNull();
    // The reservoir legend is unaffected by the snow layer's absence.
    expect(screen.getByRole("list", { name: /legend: reservoirs/i })).toBeInTheDocument();
  });
});

describe("fillForSnowPct", () => {
  it("bins percent of average pale to deep", () => {
    expect(fillForSnowPct(10)).toBe("rgb(var(--snow-s0))");
    expect(fillForSnowPct(70)).toBe("rgb(var(--snow-s1))");
    expect(fillForSnowPct(120)).toBe("rgb(var(--snow-s2))");
    expect(fillForSnowPct(300)).toBe("rgb(var(--snow-s3))");
  });

  it("puts bin edges in the deeper bin", () => {
    expect(fillForSnowPct(50)).toBe("rgb(var(--snow-s1))");
    expect(fillForSnowPct(100)).toBe("rgb(var(--snow-s2))");
    expect(fillForSnowPct(150)).toBe("rgb(var(--snow-s3))");
  });

  it("uses the neutral fill when there is no percent to show", () => {
    expect(fillForSnowPct(null)).toBe("rgb(var(--surface-container-highest))");
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
