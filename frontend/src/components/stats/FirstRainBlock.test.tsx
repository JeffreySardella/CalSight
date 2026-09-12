import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import FirstRainBlock from "./FirstRainBlock";
import type { FirstRain, FirstRainSeries } from "../../hooks/useFirstRain";

const LA_2025 = {
  county_code: 19,
  county_name: "Los Angeles",
  county_slug: "los-angeles",
  water_year: 2025,
  first_rain_date: "2024-11-04",
  precip_in: 0.3,
  dry_days_before: 120,
  crashes_on_day: 800,
  baseline_daily_crashes: 600,
  lift_pct: 33.3,
  small_baseline: false,
};
const LA_2026 = {
  ...LA_2025,
  water_year: 2026,
  first_rain_date: "2025-11-12",
  precip_in: 0.42,
  dry_days_before: 143,
  crashes_on_day: 912,
  baseline_daily_crashes: 640.2,
  lift_pct: 42.5,
};

const SUMMARY: FirstRain = {
  threshold_in: 0.1,
  min_dry_days: 14,
  baseline_days: 28,
  weather_through: "2026-08-31",
  statewide: { water_years: 1, median_lift_pct: 42.5, events: [] },
  // Two LA rows (older first) plus another county — the block must pick LA's latest.
  counties: [LA_2025, LA_2026, { ...LA_2026, county_slug: "sacramento", county_name: "Sacramento", county_code: 34 }],
  days_since_rain: [],
};

const SERIES: FirstRainSeries = {
  county_code: 19,
  county_name: "Los Angeles",
  water_year: 2026,
  first_rain_date: "2025-11-12",
  points: Array.from({ length: 29 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 9, 29 + i));
    return {
      date: d.toISOString().slice(0, 10),
      crashes: i === 14 ? 912 : 600 + i,
      precip_in: i === 14 ? 0.42 : 0,
      is_first_rain: i === 14,
    };
  }),
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function renderBlock(opts: { summary?: Response; series?: Response } = {}) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/first-rain/series")) return opts.series ?? json(SERIES);
    if (url.includes("/api/first-rain")) return opts.summary ?? json(SUMMARY);
    throw new Error(`unexpected fetch: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<FirstRainBlock countySlug="los-angeles" />, { wrapper });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstRainBlock", () => {
  it("draws 29 daily bars, highlights the first-rain day, and captions the county's latest event", async () => {
    const calls = renderBlock();
    const chart = await screen.findByRole("img", { name: /Los Angeles/ });
    const bars = chart.querySelectorAll("rect");
    expect(bars).toHaveLength(29);
    const highlighted = [...bars].filter((r) => r.getAttribute("fill") === "rgb(var(--error))");
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toBe(bars[14]);
    // Fetched the county's latest water year, not its first row.
    expect(calls.some((u) => u.includes("county=los-angeles") && u.includes("water_year=2026"))).toBe(true);
    expect(
      screen.getByText(/Los Angeles: 912 crashes on Nov 12, 2025 vs 640\/day before — \+43%/),
    ).toBeInTheDocument();
  });

  it("flags a small baseline in the caption", async () => {
    const small = { ...SUMMARY, counties: [{ ...LA_2026, small_baseline: true }] };
    renderBlock({ summary: json(small) });
    expect(await screen.findByText(/small baseline/i)).toBeInTheDocument();
  });

  it("renders nothing when the summary endpoint 404s", async () => {
    renderBlock({ summary: new Response("not found", { status: 404 }) });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing when the series 404s", async () => {
    renderBlock({ series: new Response("not found", { status: 404 }) });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
