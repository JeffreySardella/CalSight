import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import SnowpackSection from "./SnowpackSection";
import type { Snowpack } from "../../hooks/useSnowpackData";

const NO_APR1 = { apr1_swe_in: null, apr1_avg_swe_in: null, apr1_pct_of_average: null };

const SNOWPACK: Snowpack = {
  latest_date: "2026-03-01",
  statewide_pct_of_average: 112,
  apr1_date: null,
  statewide_apr1_pct_of_average: null,
  regions: [
    { region: "Central Sierra", station_count: 5, latest_date: "2026-03-01", swe_in: 24.6, avg_swe_in: 22.0, pct_of_average: 112, ...NO_APR1 },
    { region: "Northern Sierra / Trinity", station_count: 5, latest_date: "2026-03-01", swe_in: 30.1, avg_swe_in: 24.0, pct_of_average: 125, ...NO_APR1 },
    { region: "Southern Sierra", station_count: 5, latest_date: "2026-03-01", swe_in: 18.0, avg_swe_in: null, pct_of_average: null, ...NO_APR1 },
  ],
};

// July response: same-date percents are melt-season noise; April-1 figures
// carry the story.
const SNOWPACK_MELT: Snowpack = {
  latest_date: "2026-07-16",
  statewide_pct_of_average: 9,
  apr1_date: "2026-04-01",
  statewide_apr1_pct_of_average: 69,
  regions: [
    { region: "Central Sierra", station_count: 3, latest_date: "2026-07-16", swe_in: 0.2, avg_swe_in: 1.8, pct_of_average: 9.5, apr1_swe_in: 6.0, apr1_avg_swe_in: 8.7, apr1_pct_of_average: 69.2 },
    { region: "Southern Sierra", station_count: 2, latest_date: "2026-07-16", swe_in: 0.1, avg_swe_in: null, pct_of_average: null, ...NO_APR1 },
  ],
};

function mockApi(snowpack: Snowpack | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/water/snowpack")) {
      if (snowpack === null) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(snowpack), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<SnowpackSection />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SnowpackSection", () => {
  it("headlines the statewide percent of average", async () => {
    mockApi(SNOWPACK);
    renderSection();
    expect(
      await screen.findByRole("heading", { name: /Statewide snowpack is 112% of average/ }),
    ).toBeInTheDocument();
  });

  it("renders a bar per region with its percent and SWE", async () => {
    mockApi(SNOWPACK);
    renderSection();
    await screen.findByRole("heading", { name: /snowpack/i });
    const central = screen.getByRole("progressbar", { name: /Central Sierra/ });
    expect(central).toHaveAttribute("aria-valuenow", "112");
    expect(screen.getByText(/24.6″ SWE · 5 stations/)).toBeInTheDocument();
  });

  it("shows a dash for a region with no comparable history", async () => {
    mockApi(SNOWPACK);
    renderSection();
    const south = await screen.findByRole("progressbar", { name: /Southern Sierra.*no comparison/i });
    expect(south).not.toHaveAttribute("aria-valuenow");
  });

  it("credits CDEC snow sensors", async () => {
    mockApi(SNOWPACK);
    renderSection();
    expect(
      await screen.findByText(/California Data Exchange Center \(CDEC\) snow sensors/),
    ).toBeInTheDocument();
  });

  it("renders nothing when no snowpack data is loaded", async () => {
    mockApi(null);
    const { container } = renderSection();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("shows an error state instead of vanishing when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent(/snowpack/i);
  });

  it("falls back to a neutral heading when statewide pct is null (off-season)", async () => {
    mockApi({ ...SNOWPACK, statewide_pct_of_average: null });
    renderSection();
    expect(
      await screen.findByRole("heading", { name: /Sierra snowpack by region/ }),
    ).toBeInTheDocument();
  });

  it("switches to the April-1 convention during the melt season", async () => {
    mockApi(SNOWPACK_MELT);
    renderSection();
    // Headline is the season-defining April-1 number, not the noisy
    // same-date percent.
    expect(
      await screen.findByRole("heading", { name: /April 1 snowpack was 69% of average/ }),
    ).toBeInTheDocument();
    const central = screen.getByRole("progressbar", { name: /Central Sierra/ });
    expect(central).toHaveAttribute("aria-valuenow", "69");
    expect(screen.getByText(/April 1: 6.0″ SWE · now 0.2″/)).toBeInTheDocument();
    // A region without April-1 history still shows its dash.
    const south = screen.getByRole("progressbar", { name: /Southern Sierra.*no comparison/i });
    expect(south).not.toHaveAttribute("aria-valuenow");
  });

  it("keeps the same-date presentation in melt season when April-1 data is absent", async () => {
    mockApi({ ...SNOWPACK, latest_date: "2026-07-16" });
    renderSection();
    expect(
      await screen.findByRole("heading", { name: /Statewide snowpack is 112% of average/ }),
    ).toBeInTheDocument();
  });
});
