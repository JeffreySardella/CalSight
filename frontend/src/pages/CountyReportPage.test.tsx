import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CountyReportPage from "./CountyReportPage";
import { buildMetrics, pooledDeathRate, type AreaInputs } from "../lib/countyReport";
import type { CountyReport } from "../hooks/useCountyReport";

const useCountyReport = vi.fn();
const useCountyInsight = vi.fn();

vi.mock("../hooks/useCountyReport", () => ({
  useCountyReport: (name: string | null) => useCountyReport(name),
}));
vi.mock("../hooks/useCountyInsight", () => ({
  useCountyInsight: (name: string | null) => useCountyInsight(name),
}));
vi.mock("../hooks/useDataFreshness", () => ({
  useDataFreshness: () => ({
    lastUpdatedAt: new Date("2026-09-14T02:02:28Z"),
    isStale: false,
    relativeTime: "1 day ago",
    isLoading: false,
  }),
}));

const YEAR = 2025;

const STATEWIDE: AreaInputs = {
  now: { crashes: 401_670, killed: 3_402, injured: 250_000 },
  then: { crashes: 374_756, killed: 4_081, injured: 240_000 },
  drivers: 27_838_201,
  priorDrivers: 26_000_000,
  roadMiles: 396_000,
};

/** Big enough that every rate publishes — the default fixture. */
const HEALTHY: AreaInputs = {
  now: { crashes: 4_000, killed: 40, injured: 2_500 },
  then: { crashes: 3_600, killed: 44, injured: 2_300 },
  drivers: 300_000,
  priorDrivers: 280_000,
  roadMiles: 4_000,
};

function makeReport(overrides: Partial<CountyReport> = {}): CountyReport {
  return {
    countyName: "Alpine",
    countyCode: 2,
    year: YEAR,
    priorYear: YEAR - 5,
    windowStart: YEAR - 9,
    metrics: buildMetrics({ county: HEALTHY, statewide: STATEWIDE }),
    pooled: pooledDeathRate([
      { year: YEAR - 1, crashes: 3_800, killed: 38 },
      { year: YEAR, crashes: 4_000, killed: 40 },
    ]),
    trend: [
      { year: YEAR - 1, crashes: 64, killed: 2 },
      { year: YEAR, crashes: 71, killed: 1 },
    ],
    hours: [
      { hour: 8, crash_count: 5 },
      { hour: 14, crash_count: 9 },
    ],
    factors: [
      { label: "Speeding", count: 252 },
      { label: "Improper Turn", count: 205 },
    ],
    rank: { rank: 3, of: 58 },
    ...overrides,
  };
}

/** The table row whose row header is exactly `label` — "Crashes" would
 *  otherwise also match "Crashes per 100 road miles". */
function rowFor(label: string): HTMLElement {
  const header = screen.getByRole("rowheader", { name: label });
  return header.closest("tr") as HTMLElement;
}

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/county/${slug}/report`]}>
      <Routes>
        <Route path="/county/:slug/report" element={<CountyReportPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useCountyReport.mockReturnValue({
    report: makeReport(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useCountyInsight.mockReturnValue({ data: null, isLoading: false, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CountyReportPage", () => {
  it("renders the county's headline numbers beside the statewide ones", async () => {
    renderAt("alpine");

    expect(
      screen.getByRole("heading", { level: 1, name: /Alpine County crash report card/i }),
    ).toBeTruthy();
    // The summary line names the year and the three counts, all from the hook.
    expect(screen.getByText(/In 2025, the latest complete year/)).toBeTruthy();
    // Nothing is held back for a county this size.
    expect(screen.queryByText("Not shown")).toBeNull();

    const crashRow = rowFor("Crashes");
    expect(within(crashRow).getByText("4,000")).toBeTruthy();
    expect(within(crashRow).getByText("401,670")).toBeTruthy();
    // 4,000 against 3,600 five years earlier.
    expect(within(crashRow).getByText("+11.1%")).toBeTruthy();

    // Rank sentence, ordinal and denominator both from the hook.
    expect(screen.getByText(/ranks 3rd highest of the 58 counties/)).toBeTruthy();
  });

  it("gives the charts text alternatives and keeps the headings in order", () => {
    renderAt("alpine");

    const levels = screen
      .getAllByRole("heading")
      .map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(Math.max(...levels.slice(1))).toBe(2);

    expect(screen.getByRole("img", { name: /Crashes and deaths in Alpine County/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Crashes by hour of day in Alpine County/ })).toBeTruthy();
    expect(
      screen.getByRole("table", { name: /Crashes and deaths in Alpine County by year/ }),
    ).toBeTruthy();
  });

  it("omits the insight block when the narrative is null", () => {
    renderAt("alpine");
    expect(screen.queryByRole("heading", { name: "County insight" })).toBeNull();
  });

  it("shows the insight block when a narrative is present", () => {
    useCountyInsight.mockReturnValue({
      data: { narrative: "Alpine recorded fewer crashes in the latest complete year." },
      isLoading: false,
      error: null,
    });
    renderAt("alpine");
    expect(screen.getByRole("heading", { name: "County insight" })).toBeTruthy();
    expect(screen.getByText(/Alpine recorded fewer crashes/)).toBeTruthy();
  });

  /** Alpine's real 2025 shape: 68 crashes, 2 deaths. */
  const ALPINE: AreaInputs = {
    now: { crashes: 68, killed: 2, injured: 44 },
    then: { crashes: 71, killed: 4, injured: 46 },
    drivers: 1_237,
    priorDrivers: 1_100,
    roadMiles: 669,
  };

  function mockCounty(county: AreaInputs, pooledYears: Array<{ year: number; crashes: number; killed: number }>) {
    useCountyReport.mockReturnValue({
      report: makeReport({
        metrics: buildMetrics({ county, statewide: STATEWIDE }),
        pooled: pooledDeathRate(pooledYears),
        rank: null,
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  }

  const ALPINE_FIVE = [
    { year: 2021, crashes: 70, killed: 0 },
    { year: 2022, crashes: 66, killed: 2 },
    { year: 2023, crashes: 66, killed: 0 },
    { year: 2024, crashes: 71, killed: 1 },
    { year: 2025, crashes: 68, killed: 2 },
  ];

  it("withholds the death rate on too few deaths, keeping the count and the exposure rates", () => {
    mockCounty(ALPINE, ALPINE_FIVE);
    renderAt("alpine");

    // The counts still print, exactly as reported.
    expect(within(rowFor("Crashes")).getByText("68")).toBeTruthy();
    expect(within(rowFor("People killed")).getByText("2")).toBeTruthy();

    // Only the death rate is held back — 68 crashes clears the crash floor.
    expect(within(rowFor("Deaths per 1,000 crashes")).getByText("Not shown")).toBeTruthy();
    expect(within(rowFor("Crashes per 10,000 licensed drivers")).queryByText("Not shown")).toBeNull();
    expect(within(rowFor("Crashes per 100 road miles")).queryByText("Not shown")).toBeNull();

    expect(screen.getByText(/recorded 2 deaths, under the 10 this report wants/)).toBeTruthy();
  });

  it("offers the pooled five-year death rate in place of the withheld single year", () => {
    // Same county, but one heavier year pushes the pooled deaths to 12.
    mockCounty(ALPINE, [...ALPINE_FIVE.slice(0, 4), { year: 2025, crashes: 68, killed: 9 }]);
    renderAt("alpine");

    const pooledRow = rowFor("Deaths per 1,000 crashes, 2021–2025 together");
    expect(within(pooledRow).getByText(((12 / 341) * 1_000).toFixed(1))).toBeTruthy();
    expect(screen.getByText(/pools 12 deaths across 341 crashes/)).toBeTruthy();
  });

  it("says so when even five years together are too thin", () => {
    mockCounty(ALPINE, ALPINE_FIVE);
    renderAt("alpine");

    const pooledRow = rowFor("Deaths per 1,000 crashes, 2021–2025 together");
    expect(within(pooledRow).getByText("Not shown")).toBeTruthy();
    expect(screen.getByText(/comes to 5 deaths, still under 10/)).toBeTruthy();
  });

  it("replaces the rank with a note rather than ranking on a withheld rate", () => {
    mockCounty(ALPINE, ALPINE_FIVE);
    renderAt("alpine");

    expect(screen.getByText(/No rank is given\./)).toBeTruthy();
    expect(screen.queryByText(/ranks \d+\w\w highest/)).toBeNull();
  });

  it("withholds the exposure rates on too few crashes, independently of deaths", () => {
    // 40 crashes is under 50; 12 deaths clears 10.
    mockCounty(
      { ...ALPINE, now: { crashes: 40, killed: 12, injured: 20 } },
      ALPINE_FIVE,
    );
    renderAt("alpine");

    expect(within(rowFor("Deaths per 1,000 crashes")).queryByText("Not shown")).toBeNull();
    expect(within(rowFor("Crashes per 10,000 licensed drivers")).getByText("Not shown")).toBeTruthy();
    expect(within(rowFor("Crashes per 100 road miles")).getByText("Not shown")).toBeTruthy();
    expect(
      screen.getByText(/recorded 40 crashes, under the 50 this report wants before it divides/),
    ).toBeTruthy();
  });

  it("states both thresholds in the footer", () => {
    renderAt("alpine");
    expect(
      screen.getByText(/at least 10 deaths that year/),
    ).toBeTruthy();
    expect(screen.getByText(/at least 50 crashes/)).toBeTruthy();
  });

  it("shows a not-found state with a link home for a slug that is not a county", () => {
    renderAt("atlantis");

    expect(screen.getByRole("heading", { level: 1, name: /No such county/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to the map/i }).getAttribute("href")).toBe("/");
    // No data is fetched for a county that does not exist.
    expect(useCountyReport).toHaveBeenCalledWith(null);
  });

  it("shows the loading and error states the rest of the app uses", () => {
    useCountyReport.mockReturnValue({
      report: null,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    const { unmount } = renderAt("alpine");
    expect(screen.getByRole("status", { name: /Loading county report card/i })).toBeTruthy();
    unmount();

    const refetch = vi.fn();
    useCountyReport.mockReturnValue({ report: null, isLoading: false, isError: true, refetch });
    renderAt("alpine");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
  });

  it("sets the document title itself, with no scheduling trick", () => {
    // Layout stands aside for this route (see lib/pageTitles.test.ts), so the
    // title is correct as soon as the page's own effects have run.
    renderAt("alpine");
    expect(document.title).toBe("Alpine County Crash Report Card — CalSight");
  });

  it("titles the not-found state too", () => {
    renderAt("atlantis");
    expect(document.title).toBe("County Not Found — CalSight");
  });
});
