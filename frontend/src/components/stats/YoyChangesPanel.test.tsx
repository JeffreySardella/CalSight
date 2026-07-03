import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import YoyChangesPanel from "./YoyChangesPanel";

const CRASHES = {
  metric: "crashes",
  year: 2023,
  baseline_year: 2022,
  partial_year: false,
  min_baseline: 100,
  rows: [
    { county_code: 19, county_name: "Los Angeles", current: 150, previous: 100, abs_change: 50, pct_change: 50.0, small_baseline: false },
    { county_code: 30, county_name: "Orange", current: 3, previous: 1, abs_change: 2, pct_change: 200.0, small_baseline: true },
  ],
};

const FATAL = { ...CRASHES, metric: "fatal_crashes", rows: [] };

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<YoyChangesPanel />, { wrapper: wrap });
}

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("metric=fatal_crashes")) return new Response(JSON.stringify(FATAL));
    return new Response(JSON.stringify(CRASHES));
  });
}

describe("YoyChangesPanel", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders county rows with baseline→current, change and percent", async () => {
    mockFetch();
    renderPanel();
    const la = await screen.findByRole("row", { name: /Los Angeles/ });
    expect(within(la).getByText("+50%")).toBeInTheDocument();
    expect(within(la).getByText("100")).toBeInTheDocument();
    expect(within(la).getByText("150")).toBeInTheDocument();
  });

  it("flags small-baseline counties", async () => {
    mockFetch();
    renderPanel();
    const orange = await screen.findByRole("row", { name: /Orange/ });
    expect(within(orange).getByText(/small baseline/i)).toBeInTheDocument();
  });

  it("switching the metric refetches with the new metric", async () => {
    const spy = mockFetch();
    renderPanel();
    await screen.findByText(/Los Angeles/);
    await userEvent.click(screen.getByRole("radio", { name: "Fatal crashes" }));
    await vi.waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes("metric=fatal_crashes"))).toBe(true),
    );
  });

  it("keeps the small-baseline caveat visible", async () => {
    mockFetch();
    renderPanel();
    expect(
      await screen.findByText(/a large percent change on a few crashes is statistically unreliable/i),
    ).toBeInTheDocument();
  });
});
