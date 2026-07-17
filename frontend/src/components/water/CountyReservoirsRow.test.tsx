import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import CountyReservoirsRow from "./CountyReservoirsRow";
import type { ReservoirCondition } from "../../hooks/useWaterData";

const RESERVOIRS: ReservoirCondition[] = [
  {
    station_id: "PNF", name: "Pine Flat Reservoir", capacity_af: 1_000_000,
    county_code: 10, lat: 36.833, lon: -119.325, latest_date: "2026-07-14",
    storage_af: 620_000, pct_of_capacity: 62.0, avg_storage_af: 600_000,
    pct_of_average: 103.3,
  },
  {
    station_id: "MIL", name: "Millerton Lake", capacity_af: 520_500,
    county_code: 10, lat: 37.001, lon: -119.705, latest_date: "2026-07-14",
    storage_af: 416_400, pct_of_capacity: 80.0, avg_storage_af: null,
    pct_of_average: null,
  },
  {
    station_id: "SHA", name: "Shasta Lake", capacity_af: 4_552_000,
    county_code: 45, lat: 40.718, lon: -122.42, latest_date: "2026-07-14",
    storage_af: 3_414_000, pct_of_capacity: 75.0, avg_storage_af: null,
    pct_of_average: null,
  },
];

function mockApi(reservoirs: ReservoirCondition[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/water/reservoirs")) {
      return new Response(JSON.stringify(reservoirs), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderRow(countyName: string, countyCode: number | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <CountyReservoirsRow countyName={countyName} countyCode={countyCode} />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CountyReservoirsRow", () => {
  it("lists only the county's reservoirs with their percent of capacity", async () => {
    mockApi(RESERVOIRS);
    renderRow("Fresno", 10);
    expect(await screen.findByText("Pine Flat Reservoir")).toBeInTheDocument();
    expect(screen.getByText("Millerton Lake")).toBeInTheDocument();
    expect(screen.queryByText("Shasta Lake")).not.toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Pine Flat Reservoir: 62% of capacity" }),
    ).toBeInTheDocument();
  });

  it("links to the water page", async () => {
    mockApi(RESERVOIRS);
    renderRow("Fresno", 10);
    const link = await screen.findByRole("link", { name: /water/i });
    expect(link).toHaveAttribute("href", "/water");
  });

  it("renders nothing for a county without tracked reservoirs", async () => {
    mockApi(RESERVOIRS);
    const { container } = renderRow("Alpine", 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the county code is unresolved", async () => {
    mockApi(RESERVOIRS);
    const { container } = renderRow("Atlantis", undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while reservoir data hasn't loaded", async () => {
    mockApi([]);
    const { container } = renderRow("Fresno", 10);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });
});
