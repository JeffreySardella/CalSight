import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import PrecipSection from "./PrecipSection";
import type { PrecipIndex } from "../../hooks/usePrecipData";

const PRECIP: PrecipIndex[] = [
  { station_id: "8SI", name: "Northern Sierra 8-Station Index", region: "Northern Sierra (8-Station)", latest_date: "2026-07-17", accum_in: 50.8, avg_accum_in: 40.0, pct_of_average: 127 },
  { station_id: "5SI", name: "San Joaquin 5-Station Index", region: "San Joaquin (5-Station)", latest_date: "2026-07-17", accum_in: 35.0, avg_accum_in: 30.0, pct_of_average: 117 },
  { station_id: "6SI", name: "Tulare Basin 6-Station Index", region: "Tulare Basin (6-Station)", latest_date: "2026-07-17", accum_in: 24.1, avg_accum_in: null, pct_of_average: null },
];

function mockApi(precip: PrecipIndex[] | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/water/precip")) {
      if (precip === null) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(precip), {
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
  return render(<PrecipSection />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PrecipSection", () => {
  it("headlines the 8-Station Index percent of average", async () => {
    mockApi(PRECIP);
    renderSection();
    expect(
      await screen.findByRole("heading", { name: /8-Station Index is 127% of average/ }),
    ).toBeInTheDocument();
  });

  it("renders a bar per index with its percent and accumulated total", async () => {
    mockApi(PRECIP);
    renderSection();
    await screen.findByRole("heading", { name: /8-Station Index/ });
    const north = screen.getByRole("progressbar", { name: /Northern Sierra/ });
    expect(north).toHaveAttribute("aria-valuenow", "127");
    expect(screen.getByText(/50.8″ so far this water year/)).toBeInTheDocument();
  });

  it("shows a dash for an index with no comparable history", async () => {
    mockApi(PRECIP);
    renderSection();
    const tulare = await screen.findByRole("progressbar", { name: /Tulare Basin.*no comparison/i });
    expect(tulare).not.toHaveAttribute("aria-valuenow");
  });

  it("credits CDEC precipitation indices", async () => {
    mockApi(PRECIP);
    renderSection();
    expect(
      await screen.findByText(/California Data Exchange Center \(CDEC\)/),
    ).toBeInTheDocument();
  });

  it("renders nothing when no precip data is loaded", async () => {
    mockApi(null);
    const { container } = renderSection();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("shows an error state instead of vanishing when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("boom", { status: 500 }),
    );
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent(/precipitation/i);
  });

  it("falls back to a neutral heading when the 8-Station Index has no percent", async () => {
    const noHistory = PRECIP.map((p) =>
      p.station_id === "8SI" ? { ...p, avg_accum_in: null, pct_of_average: null } : p,
    );
    mockApi(noHistory);
    renderSection();
    expect(
      await screen.findByRole("heading", { name: /Sierra precipitation by index/ }),
    ).toBeInTheDocument();
  });
});
