import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import CountyDroughtRow from "./CountyDroughtRow";
import type { DroughtSnapshot } from "../../hooks/useDroughtData";

const SNAPSHOT: DroughtSnapshot = {
  week_start: "2026-06-30",
  statewide: { none_pct: 50, d0_pct: 10, d1_pct: 30, d2_pct: 10, d3_pct: 0, d4_pct: 0 },
  counties: [
    { county_code: 15, none_pct: 0, d0_pct: 10, d1_pct: 40, d2_pct: 50, d3_pct: 0, d4_pct: 0 },
    { county_code: 1, none_pct: 100, d0_pct: 0, d1_pct: 0, d2_pct: 0, d3_pct: 0, d4_pct: 0 },
  ],
};

function mockApi(snapshot: DroughtSnapshot | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/water/drought")) {
      if (snapshot === null) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(snapshot), {
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
    <CountyDroughtRow countyName={countyName} countyCode={countyCode} />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CountyDroughtRow", () => {
  it("shows the county's D1+ percentage with a severity bar", async () => {
    mockApi(SNAPSHOT);
    renderRow("Kern", 15);
    expect(await screen.findByText("90% in drought (D1+)")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Kern County drought severity/ }),
    ).toBeInTheDocument();
  });

  it("says so when the county is drought-free", async () => {
    mockApi(SNAPSHOT);
    renderRow("Alameda", 1);
    expect(await screen.findByText("No drought this week")).toBeInTheDocument();
  });

  it("links to the water page", async () => {
    mockApi(SNAPSHOT);
    renderRow("Kern", 15);
    const link = await screen.findByRole("link", { name: /water/i });
    expect(link).toHaveAttribute("href", "/water");
  });

  it("renders nothing without drought data", async () => {
    mockApi(null);
    const { container } = renderRow("Kern", 15);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("renders nothing when the county code is unresolved", async () => {
    mockApi(SNAPSHOT);
    const { container } = renderRow("Atlantis", undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });
});
