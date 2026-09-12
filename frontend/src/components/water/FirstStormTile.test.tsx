import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import FirstStormTile from "./FirstStormTile";
import type { FirstRain } from "../../hooks/useFirstRain";

const PAYLOAD: FirstRain = {
  threshold_in: 0.1,
  min_dry_days: 14,
  baseline_days: 28,
  weather_through: "2026-08-31",
  statewide: {
    water_years: 24,
    median_lift_pct: 31.4,
    events: [
      { water_year: 2024, counties: 58, crashes_on_first_rain_days: 1100, baseline_expected: 900, lift_pct: 22.2, median_first_rain_date: "2023-11-01" },
      { water_year: 2025, counties: 58, crashes_on_first_rain_days: 1234, baseline_expected: 980.5, lift_pct: 25.9, median_first_rain_date: "2024-11-04" },
      { water_year: 2026, counties: 58, crashes_on_first_rain_days: 1500, baseline_expected: 1000, lift_pct: 50, median_first_rain_date: "2025-11-12" },
    ],
  },
  counties: [],
  days_since_rain: [
    { county_code: 19, county_name: "Los Angeles", county_slug: "los-angeles", last_rain_date: "2026-05-12", days: 111 },
    { county_code: 34, county_name: "Sacramento", county_slug: "sacramento", last_rain_date: "2026-08-20", days: 11 },
    { county_code: 37, county_name: "San Diego", county_slug: "san-diego", last_rain_date: "2026-06-01", days: 91 },
  ],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function renderTile(response: Response) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/first-rain")) return response;
    throw new Error(`unexpected fetch: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<FirstStormTile />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstStormTile", () => {
  it("renders the statewide lift, latest event, dry-county count and story link", async () => {
    renderTile(json(PAYLOAD));
    const tile = await screen.findByRole("region", { name: /first storm/i });
    expect(tile).toHaveTextContent(/why water is a road-safety story/i);
    expect(screen.getByText("+31%")).toHaveClass("text-error");
    expect(tile).toHaveTextContent(/median of 24 water years, 58 counties/);
    // Latest event (2026), not the first one.
    expect(tile).toHaveTextContent(
      /Water year 2026: first storms landed around Nov 12, 2025; 1,500 crashes vs 1,000 expected \(\+50%\)/,
    );
    // Two of three counties are >= 30 days dry.
    expect(tile).toHaveTextContent(
      /2 counties have gone 30\+ days without measurable rain as of Aug 31, 2026/,
    );
    expect(screen.getByRole("img", { name: /first-storm effect by water year/i })).toBeInTheDocument();
    expect(tile).toHaveTextContent(/Association, not causation/);
    expect(screen.getByRole("link", { name: /see the story/i })).toHaveAttribute(
      "href",
      "/stats?story=first-storm",
    );
  });

  it("says so when no county is 30+ days dry", async () => {
    const wet = {
      ...PAYLOAD,
      days_since_rain: PAYLOAD.days_since_rain.map((d) => ({ ...d, days: 3 })),
    };
    renderTile(json(wet));
    const tile = await screen.findByRole("region", { name: /first storm/i });
    expect(tile).toHaveTextContent(/Every county has seen measurable rain in the last 30 days/);
  });

  it("renders nothing on 404", async () => {
    renderTile(new Response("not found", { status: 404 }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders nothing on a server error", async () => {
    renderTile(new Response("boom", { status: 500 }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
