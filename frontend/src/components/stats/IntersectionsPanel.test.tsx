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
    severity_score: 321,
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
    severity_score: 738,
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

const CONCENTRATION = {
  scope: "intersections",
  county_code: 19,
  county_name: "Los Angeles",
  total_units: 100,
  total_crashes: 500,
  total_severe_crashes: 200,
  breakpoints: [
    { label: "Top 1%", top_pct: 1, unit_count: 1, severe_share_pct: 20.0 },
    { label: "Top 5%", top_pct: 5, unit_count: 5, severe_share_pct: 45.0 },
    { label: "Top 10%", top_pct: 10, unit_count: 10, severe_share_pct: 66.0 },
    { label: "Top 25%", top_pct: 25, unit_count: 25, severe_share_pct: 85.0 },
  ],
};

function mockFetchByScope() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/street-concentration")) {
      return new Response(JSON.stringify(CONCENTRATION));
    }
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
    // County appears in the sub-heading (and the concentration summary); at least one.
    expect(screen.getAllByText(/Los Angeles County/).length).toBeGreaterThan(0);
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

  it("mode filter sends the pedestrian flag to the query", async () => {
    const spy = mockFetchByScope();
    renderPanel();
    await screen.findByText("Main St & 1st Ave");

    await userEvent.click(screen.getByRole("radio", { name: "Pedestrian" }));

    await vi.waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes("pedestrian=true"))).toBe(true),
    );
  });

  it("severity-weighted sort sends sort=severity and shows the Score column", async () => {
    const spy = mockFetchByScope();
    renderPanel();
    await screen.findByText("Main St & 1st Ave");
    // Score column is present, showing the severity_score.
    expect(screen.getByRole("columnheader", { name: "Score" })).toBeInTheDocument();
    expect(screen.getByText("321")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Severity-weighted" }));

    await vi.waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).includes("sort=severity"))).toBe(true),
    );
  });

  it("links each row to the map centered on its coordinates", async () => {
    mockFetchByScope();
    renderPanel();
    const link = await screen.findByRole("link", { name: /View Main St & 1st Ave on the map/i });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("lat=34.0000");
    expect(href).toContain("lng=-118.2000");
    expect(href).toContain("zoom=16");
  });

  it("shows the neutral concentration summary", async () => {
    mockFetchByScope();
    renderPanel();
    const summary = await screen.findByText(/The top 10% of/i);
    expect(summary).toHaveTextContent("66%");
    expect(summary).toHaveTextContent("fatal & injury crashes");
    // honest denominator disclaimer, not "all roads"
    expect(summary).toHaveTextContent(/at least one recorded crash, not all roads/i);
  });

  it("renders the neutral empty state when there are no results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
    renderPanel();
    expect(
      await screen.findByText("No intersections match these filters."),
    ).toBeInTheDocument();
  });

  it("renders an error state with a retry action on failure", async () => {
    // 4xx so the assertion isn't racing the retry backoff — the hook's own
    // `retry` overrides the test client's `retry: false`. See the matching
    // note in useIntersections.test.tsx.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 400 }));
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't load results")).toBeInTheDocument();
  });

  it("shows the server's own explanation when the query was too large", async () => {
    // The statewide scan can exceed the query timeout; the API answers 503
    // with actionable advice, which beats a generic "something went wrong".
    const detail =
      "This street-level query covers too much data to finish in time. " +
      "Narrow it with a county or a year range and it will return quickly.";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status: 503 }),
    );
    renderPanel();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Too much data for one query")).toBeInTheDocument();
    expect(within(alert).getByText(detail)).toBeInTheDocument();
  });
});
