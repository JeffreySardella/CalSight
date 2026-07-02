import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import IntersectionsPanel from "./IntersectionsPanel";

const INTERSECTION_ROWS = [
  {
    county_code: 19,
    county_name: "Los Angeles",
    primary_road: "Main St",
    secondary_road: "1st Ave",
    crash_count: 42,
    fatal_count: 1,
    injury_count: 20,
    pdo_count: 21,
    killed: 1,
    injured: 25,
    latitude: 34.0,
    longitude: -118.2,
  },
];

const CORRIDOR_ROWS = [
  {
    county_code: 19,
    county_name: "Los Angeles",
    primary_road: "Sunset Blvd",
    secondary_road: null,
    crash_count: 90,
    fatal_count: 2,
    injury_count: 50,
    pdo_count: 38,
    killed: 2,
    injured: 60,
    latitude: 34.1,
    longitude: -118.3,
  },
];

function renderPanel(initialEntry = "/stats") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<IntersectionsPanel />, { wrapper: wrap });
}

function mockFetchByScope() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/corridors")) {
      return new Response(JSON.stringify(CORRIDOR_ROWS));
    }
    return new Response(JSON.stringify(INTERSECTION_ROWS));
  });
}

describe("IntersectionsPanel", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders intersection rows with neutral column headers", async () => {
    mockFetchByScope();
    renderPanel();

    await screen.findByText("Main St & 1st Ave");

    // Neutral, factual column headers.
    expect(screen.getByRole("columnheader", { name: "Crashes" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Fatal" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Injury" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "PDO" })).toBeInTheDocument();

    // No loaded / advocacy wording anywhere in the panel.
    expect(document.body.textContent).not.toMatch(/deadliest|dangerous|worst|hotspot/i);
  });

  it("shows a Statewide label when no single county is selected", async () => {
    mockFetchByScope();
    renderPanel("/stats");
    expect(await screen.findByText(/Statewide/)).toBeInTheDocument();
  });

  it("scopes to the county when exactly one county is selected", async () => {
    const spy = mockFetchByScope();
    renderPanel("/stats?county=los-angeles");
    await screen.findByText("Main St & 1st Ave");
    expect(screen.getByText(/Los Angeles County/)).toBeInTheDocument();
    expect(String(spy.mock.calls[0][0])).toContain("county=los-angeles");
  });

  it("toggle switches scope to corridors and refetches", async () => {
    const spy = mockFetchByScope();
    renderPanel();
    await screen.findByText("Main St & 1st Ave");

    await userEvent.click(screen.getByRole("radio", { name: "Corridors" }));

    await screen.findByText("Sunset Blvd");
    expect(screen.getByRole("heading", { name: /Corridors by crash count/ })).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => String(c[0]).includes("/api/corridors"))).toBe(true);
  });

  it("renders the neutral empty state when there are no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    renderPanel();
    expect(
      await screen.findByText("No intersections match these filters."),
    ).toBeInTheDocument();
  });

  it("renders an error state with a retry action on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't load results")).toBeInTheDocument();
  });
});
