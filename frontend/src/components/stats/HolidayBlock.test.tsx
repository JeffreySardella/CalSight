import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import HolidayBlock from "./HolidayBlock";
import type { Holiday, Holidays } from "../../hooks/useHolidays";

function holiday(over: Partial<Holiday> & Pick<Holiday, "key" | "label">): Holiday {
  return {
    baseline_month: "November",
    days: 5,
    crashes: 10,
    killed: 2,
    dui_crashes: 4,
    crashes_per_day: 2,
    deaths_per_day: 0.4,
    dui_share_pct: 40,
    baseline: {
      days: 25, crashes: 5, killed: 1, dui_crashes: 1,
      crashes_per_day: 0.2, deaths_per_day: 0.04, dui_share_pct: 20,
    },
    crashes_lift_pct: 900,
    deaths_lift_pct: 900,
    dui_share_lift_pct: 100,
    ...over,
  };
}

const PAYLOAD: Holidays = {
  first_year: 2016,
  last_year: 2025,
  county_code: null,
  county_name: null,
  holidays: [
    holiday({ key: "thanksgiving", label: "Thanksgiving (Wed-Sun)" }),
    holiday({
      key: "super_bowl",
      label: "Super Bowl Sunday",
      baseline_month: "February",
      days: 10,
      crashes_per_day: 0.9,
      crashes_lift_pct: -10,
      deaths_lift_pct: -5,
      dui_share_lift_pct: 25,
    }),
    holiday({
      key: "halloween",
      label: "Halloween night",
      baseline_month: "October",
      crashes_lift_pct: null,
      deaths_lift_pct: null,
      dui_share_lift_pct: null,
    }),
  ],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function renderBlock(response?: Response, countySlug?: string) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    calls.push(String(input));
    return response ?? json(PAYLOAD);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<HolidayBlock countySlug={countySlug} />, { wrapper });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HolidayBlock", () => {
  it("renders one row per holiday with the rates and lifts from the endpoint", async () => {
    renderBlock();
    expect(await screen.findByRole("row", { name: /Thanksgiving/ })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3 holidays

    const row = screen.getByRole("row", { name: /Thanksgiving/ });
    expect(row).toHaveTextContent("5 days vs 25 ordinary November days");
    expect(row).toHaveTextContent("2.0");      // crashes/day
    expect(row).toHaveTextContent("0.20 ordinary");
    expect(row).toHaveTextContent("+900%");
    expect(row).toHaveTextContent("40.0%");    // DUI share
    expect(row).toHaveTextContent("+100%");
  });

  it("signs a negative lift and keeps its own baseline month", async () => {
    renderBlock();
    const row = await screen.findByRole("row", { name: /Super Bowl/ });
    expect(row).toHaveTextContent("-10%");
    expect(row).toHaveTextContent("ordinary February days");
  });

  it("shows an em dash rather than a zero when the lift is undefined", async () => {
    renderBlock();
    const row = await screen.findByRole("row", { name: /Halloween/ });
    expect(row).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("+0%");
  });

  it("caveats the daily granularity and the fatality lag, naming the newest year", async () => {
    renderBlock();
    expect(await screen.findByText(/October 31 and November 1/)).toBeInTheDocument();
    expect(screen.getByText(/lag crash records by six months/)).toBeInTheDocument();
    expect(screen.getByText(/2025 is the newest year/)).toBeInTheDocument();
  });

  it("passes the county through and names it", async () => {
    const county = { ...PAYLOAD, county_code: 19, county_name: "Los Angeles" };
    const calls = renderBlock(json(county), "los-angeles");
    // Both the visible caption and the table's screen-reader caption name it.
    expect(await screen.findAllByText(/Los Angeles County/)).toHaveLength(2);
    expect(calls[0]).toContain("county=los-angeles");
  });

  it("fetches statewide when no county is given", async () => {
    const calls = renderBlock();
    await screen.findByRole("table");
    expect(calls[0]).not.toContain("county=");
  });

  it("renders nothing while the matview is unpopulated", async () => {
    renderBlock(json({ ...PAYLOAD, holidays: [] }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders nothing when the endpoint 404s", async () => {
    renderBlock(new Response("not found", { status: 404 }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
