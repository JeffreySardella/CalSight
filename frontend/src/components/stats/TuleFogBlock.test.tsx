import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import TuleFogBlock from "./TuleFogBlock";
import type { FogDays, FogYear } from "../../hooks/useFogDays";

function year(y: number, over: Partial<FogYear> = {}): FogYear {
  return {
    year: y,
    fog_event_days: 10,
    crashes_on_fog_days: 200,
    fog_day_avg_crashes: 20,
    baseline_days: 100,
    crashes_off_fog_days: 1000,
    baseline_avg_crashes: 10,
    lift_pct: 100,
    fog_coded_crashes: 40,
    ...over,
  };
}

const FRESNO: FogDays = {
  county: "fresno",
  year: null,
  fog_event_type: "Dense Fog",
  // Ascending, exactly as the API returns it — the block re-orders for display.
  months: [1, 2, 3, 11, 12],
  storm_events_through: 2024,
  totals: year(2024),
  years: [year(2022), year(2023), year(2024)],
  counties: [
    {
      county_code: 10,
      county_name: "Fresno",
      county_slug: "fresno",
      years: [year(2022), year(2023), year(2024)],
    },
  ],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function renderBlock(response?: Response) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/fog-days")) return response ?? json(FRESNO);
    throw new Error(`unexpected fetch: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<TuleFogBlock countySlug="fresno" />, { wrapper });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TuleFogBlock", () => {
  it("draws a fog-day and a baseline bar per year and captions the pooled lift", async () => {
    const calls = renderBlock();
    const chart = await screen.findByRole("img", { name: /Fresno/ });
    // Two bars per year: fog days, then every other day in the same months.
    expect(chart.querySelectorAll("rect")).toHaveLength(6);
    expect(calls.some((u) => u.includes("county=fresno"))).toBe(true);
    expect(
      screen.getByText(/20\.0 crashes\/day across 30 fog-advisory days vs 10\.0\/day/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\+100%/)).toBeInTheDocument();
  });

  it("names the months the API actually compared against, not 'winter'", async () => {
    renderBlock();
    const chart = await screen.findByRole("img");
    // The API sends [1, 2, 3, 11, 12]; the whole fog season reads as a range.
    const months = /November through March/;
    expect(chart.getAttribute("aria-label")).toMatch(months);
    expect(chart.closest("figure")?.querySelector("figcaption")?.textContent).toMatch(months);
  });

  it("orders a partial month set from November rather than from January", async () => {
    renderBlock(json({ ...FRESNO, months: [1, 12] }));
    const chart = await screen.findByRole("img");
    expect(chart.getAttribute("aria-label")).toMatch(/December and January/);
  });

  it("says association, not cause", async () => {
    renderBlock();
    expect(await screen.findByText(/Association, not cause/)).toBeInTheDocument();
  });

  it("leaves thin years out of the headline but still draws them", async () => {
    const thin = {
      ...FRESNO,
      counties: [
        {
          ...FRESNO.counties[0],
          years: [
            year(2023),
            // One fog day with a freak 99-crash count must not move the total.
            year(2024, {
              fog_event_days: 1,
              crashes_on_fog_days: 99,
              fog_day_avg_crashes: 99,
              crashes_off_fog_days: 500,
            }),
          ],
        },
      ],
    };
    renderBlock(json(thin));
    expect(
      await screen.findByText(/20\.0 crashes\/day across 10 fog-advisory days/),
    ).toBeInTheDocument();
    expect(screen.getByRole("img").querySelectorAll("rect")).toHaveLength(4);
  });

  it("renders nothing when the endpoint 404s", async () => {
    renderBlock(new Response("not found", { status: 404 }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing when the county has no fog record yet", async () => {
    renderBlock(json({ ...FRESNO, totals: null, years: [], counties: [] }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders nothing when every year is too thin to count", async () => {
    const thin = {
      ...FRESNO,
      counties: [
        {
          ...FRESNO.counties[0],
          years: [year(2024, { fog_event_days: 1, crashes_on_fog_days: 4, fog_day_avg_crashes: 4 })],
        },
      ],
    };
    renderBlock(json(thin));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Better nothing than "0.0 crashes/day across 0 fog-advisory days".
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
