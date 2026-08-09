import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import HighwayRankingsTable from "./HighwayRankingsTable";
import type { StatsFilters } from "../../hooks/useStats";

const FILTERS: StatsFilters = {
  dateRange: null,
  severities: [],
  causes: [],
  counties: [],
  alcohol: false,
  pedestrian: false,
  cyclist: false,
  drug: false,
};

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<HighwayRankingsTable filters={FILTERS} />, { wrapper: wrap });
}

describe("HighwayRankingsTable", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("shows ONLY an error state on failure — not the empty-state too", async () => {
    // Regression: on a server error the component rendered "Failed to load"
    // AND "No highway crashes match the current filters" together, making an
    // error look like a successful zero-result. 400 so it doesn't retry.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 400 }));
    renderTable();

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(
      screen.queryByText(/No highway crashes match/i),
    ).not.toBeInTheDocument();
  });

  it("shows the empty-state only on a genuine empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    renderTable();

    expect(
      await screen.findByText(/No highway crashes match/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders rows on success", async () => {
    const rows = [{
      route_number: "US-101", crash_count: 1234, fatal_count: 10,
      fatality_rate: 0.8, crashes_per_mile: 5.1, corridor_miles: 240,
    }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(rows), { status: 200 }),
    );
    renderTable();

    await waitFor(() =>
      expect(screen.getByText("US-101")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No highway crashes match/i)).not.toBeInTheDocument();
  });
});
