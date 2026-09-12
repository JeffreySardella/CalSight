import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import CountyFirstRainRow from "./CountyFirstRainRow";
import type { FirstRain } from "../../hooks/useFirstRain";

const DATA: FirstRain = {
  threshold_in: 0.1,
  min_dry_days: 14,
  baseline_days: 28,
  weather_through: "2025-11-02",
  statewide: { water_years: 1, median_lift_pct: 31, events: [] },
  counties: [
    {
      county_code: 19, county_name: "Los Angeles", county_slug: "los-angeles", water_year: 2026,
      first_rain_date: "2025-10-21", precip_in: 0.4, dry_days_before: 20,
      crashes_on_day: 412, baseline_daily_crashes: 315.4, lift_pct: 30.6, small_baseline: false,
    },
    {
      county_code: 3, county_name: "Alpine", county_slug: "alpine", water_year: 2026,
      first_rain_date: "2025-10-21", precip_in: 0.4, dry_days_before: 20,
      crashes_on_day: 3, baseline_daily_crashes: 1, lift_pct: 200, small_baseline: true,
    },
  ],
  days_since_rain: [
    { county_code: 19, county_name: "Los Angeles", county_slug: "los-angeles", last_rain_date: "2025-10-21", days: 12 },
    { county_code: 3, county_name: "Alpine", county_slug: "alpine", last_rain_date: "2025-11-02", days: 0 },
    { county_code: 30, county_name: "Orange", county_slug: "orange", last_rain_date: "2025-10-30", days: 3 },
  ],
};

function mockApi(data: FirstRain | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/first-rain")) {
      if (data === null) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderRow(countyCode: number | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<CountyFirstRainRow countyCode={countyCode} />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CountyFirstRainRow", () => {
  it("shows days since rain and the latest first-storm event", async () => {
    mockApi(DATA);
    renderRow(19);
    expect(await screen.findByText("12 days since measurable rain")).toBeInTheDocument();
    expect(
      screen.getByText("First storm of WY2026 (Oct 21, 2025): 412 crashes vs 315.4/day, +31%"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /water/i })).toHaveAttribute("href", "/water");
  });

  it("says 'Rain in the last day' at zero days and flags small baselines", async () => {
    mockApi(DATA);
    renderRow(3);
    expect(await screen.findByText("Rain in the last day")).toBeInTheDocument();
    expect(screen.getByText(/3 crashes vs 1\.0\/day, \+200% \(small numbers\)/)).toBeInTheDocument();
  });

  it("renders only the days line when the county has no event", async () => {
    mockApi(DATA);
    renderRow(30);
    expect(await screen.findByText("3 days since measurable rain")).toBeInTheDocument();
    expect(screen.queryByText(/First storm/)).not.toBeInTheDocument();
  });

  it("renders nothing on 404", async () => {
    mockApi(null);
    const { container } = renderRow(19);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("renders nothing for an unknown county", async () => {
    mockApi(DATA);
    const { container } = renderRow(undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });
});
