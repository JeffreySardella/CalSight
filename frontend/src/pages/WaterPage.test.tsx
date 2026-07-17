import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import WaterPage from "./WaterPage";
import { summarize, type ReservoirCondition } from "../hooks/useWaterData";

const SHASTA: ReservoirCondition = {
  station_id: "SHA",
  name: "Shasta Lake",
  capacity_af: 4_552_000,
  county_code: 45,
  lat: 40.718,
  lon: -122.42,
  latest_date: "2026-07-09",
  storage_af: 3_400_000,
  pct_of_capacity: 74.7,
  avg_storage_af: 3_000_000,
  pct_of_average: 113.3,
};

const CASTAIC: ReservoirCondition = {
  station_id: "CAS",
  name: "Castaic Lake",
  capacity_af: 325_000,
  county_code: 19,
  lat: 34.5152,
  lon: -118.6101,
  latest_date: "2026-07-09",
  storage_af: 260_000,
  pct_of_capacity: 80.0,
  avg_storage_af: null,
  pct_of_average: null,
};

function renderPage(rows: ReservoirCondition[] | Error) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/water/reservoirs")) {
      if (rows instanceof Error) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify(rows), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/water/drought")) {
      // No drought data in these scenarios — the section hides itself.
      return new Response("not found", { status: 404 });
    }
    if (url.includes("/api/water/snowpack")) {
      // No snowpack data either — that section hides itself too.
      return new Response("not found", { status: 404 });
    }
    if (url.includes("/api/water/precip")) {
      // No precip-index data either — that section hides itself too.
      return new Response("not found", { status: 404 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<WaterPage />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WaterPage", () => {
  it("renders a card per reservoir with percent of capacity", async () => {
    renderPage([SHASTA, CASTAIC]);
    expect(await screen.findByText("Shasta Lake")).toBeInTheDocument();
    expect(screen.getByText("Castaic Lake")).toBeInTheDocument();
    const gauge = screen.getByRole("progressbar", { name: /Shasta Lake/ });
    expect(gauge).toHaveAttribute("aria-valuenow", "75");
  });

  it("shows the statewide summary with storage-weighted percent of average", async () => {
    renderPage([SHASTA, CASTAIC]);
    const summary = await screen.findByRole("region", { name: /statewide summary/i });
    expect(summary).toHaveTextContent("3.66M"); // 3.4M + 260K acre-feet
    // Only Shasta has history: 3.4M / 3.0M ≈ 113%
    expect(summary).toHaveTextContent("113%");
  });

  it("omits the percent-of-average figure when no reservoir has history", async () => {
    renderPage([CASTAIC]);
    const summary = await screen.findByRole("region", { name: /statewide summary/i });
    expect(summary).toHaveTextContent("—");
  });

  it("shows an error state when the API fails", async () => {
    renderPage(new Error("boom"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load/i),
    );
  });

  it("shows an empty state when no data is loaded yet", async () => {
    renderPage([]);
    expect(
      await screen.findByText(/no reservoir data has been loaded/i),
    ).toBeInTheDocument();
  });

  it("credits CDEC as the data source", async () => {
    renderPage([SHASTA]);
    expect(
      await screen.findByText(/California Data Exchange Center/),
    ).toBeInTheDocument();
  });
});

describe("summarize", () => {
  it("returns null for an empty list", () => {
    expect(summarize([])).toBeNull();
  });

  it("weights the average by storage, excluding no-history reservoirs", () => {
    const s = summarize([SHASTA, CASTAIC])!;
    expect(s.totalStorageAf).toBe(3_660_000);
    expect(s.totalCapacityAf).toBe(4_877_000);
    // Only Shasta contributes: 3.4M / 3.0M
    expect(s.pctOfAverage).toBeCloseTo(113.3, 0);
  });

  it("returns null percent-of-average without any history", () => {
    expect(summarize([CASTAIC])!.pctOfAverage).toBeNull();
  });
});
