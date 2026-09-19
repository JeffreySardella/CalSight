import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CountyReportPage from "./CountyReportPage";
import { buildMetrics } from "../lib/countyReport";
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

function makeReport(overrides: Partial<CountyReport> = {}): CountyReport {
  return {
    countyName: "Alpine",
    countyCode: 2,
    year: YEAR,
    priorYear: YEAR - 5,
    windowStart: YEAR - 9,
    metrics: buildMetrics({
      county: {
        now: { crashes: 71, killed: 1, injured: 63 },
        then: { crashes: 60, killed: 2, injured: 50 },
        drivers: 1_237,
        priorDrivers: 1_100,
        roadMiles: 669,
      },
      statewide: {
        now: { crashes: 401_670, killed: 3_402, injured: 250_000 },
        then: { crashes: 374_756, killed: 4_081, injured: 240_000 },
        drivers: 27_838_201,
        priorDrivers: 26_000_000,
        roadMiles: 396_000,
      },
    }),
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

    const crashRow = rowFor("Crashes");
    expect(within(crashRow).getByText("71")).toBeTruthy();
    expect(within(crashRow).getByText("401,670")).toBeTruthy();
    // 71 against 60 five years earlier.
    expect(within(crashRow).getByText("+18.3%")).toBeTruthy();

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

  it("says a rate is not shown when the county's count is too small", () => {
    useCountyReport.mockReturnValue({
      report: makeReport({
        metrics: buildMetrics({
          county: {
            now: { crashes: 3, killed: 1, injured: 1 },
            then: { crashes: 4, killed: 0, injured: 2 },
            drivers: 1_000,
            priorDrivers: 900,
            roadMiles: 669,
          },
          statewide: {
            now: { crashes: 401_670, killed: 3_402, injured: 250_000 },
            then: { crashes: 374_756, killed: 4_081, injured: 240_000 },
            drivers: 27_838_201,
            priorDrivers: 26_000_000,
            roadMiles: 396_000,
          },
        }),
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderAt("alpine");

    // The counts still print…
    expect(within(rowFor("Crashes")).getByText("3")).toBeTruthy();
    // …and each rate row is marked, with one plain-language note explaining it.
    expect(screen.getAllByText("Not shown").length).toBe(3);
    expect(screen.getByText(/too small for a stable rate/)).toBeTruthy();
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

  it("sets the document title for the county", async () => {
    renderAt("alpine");
    await Promise.resolve();
    expect(document.title).toBe("Alpine County Crash Report Card — CalSight");
  });
});
