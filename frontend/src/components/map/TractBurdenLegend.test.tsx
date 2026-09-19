import { useEffect, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

vi.mock("../../config", () => ({ API_BASE: "", WATER_PAGE_PUBLIC: true }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import TractBurdenLegend from "./TractBurdenLegend";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <ThemeProvider>
        <CustomThemeProvider>
          <QueryClientProvider client={qc}>
            <LayersStateProvider>{children}</LayersStateProvider>
          </QueryClientProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function EnableLayer() {
  const { setOtherLayer } = useLayersState();
  useEffect(() => setOtherLayer("tractBurden", true), [setOtherLayer]);
  return null;
}

const BODY = {
  summary: {
    coord_share: 0.42,
    tract_count: 2,
    start_year: null,
    end_year: null,
    population_available: true,
  },
  tracts: [
    {
      geoid: "06037100100", county_code: 19, ces_percentile: 88,
      crash_count: 40, killed: 3, injured: 10, crashes_per_1k_pop: 10,
    },
    {
      geoid: "06037100200", county_code: 19, ces_percentile: 15,
      crash_count: 5, killed: 0, injured: 1, crashes_per_1k_pop: 2.5,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/tract-burden")) {
      return { ok: true, status: 200, json: async () => BODY } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TractBurdenLegend", () => {
  it("renders nothing while the layer is off, and fetches nothing", () => {
    render(
      <Providers>
        <TractBurdenLegend />
      </Providers>,
    );
    expect(screen.queryByTestId("tract-burden-legend")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows the coordinate-coverage caveat computed from the response", async () => {
    render(
      <Providers>
        <EnableLayer />
        <TractBurdenLegend />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("tract-burden-legend")).toBeInTheDocument();
    });
    // The percentage must come from the API's coord_share for the selected
    // years, not a hard-coded "~37%".
    await screen.findByText("42%");
    expect(
      screen.getByText(/crashes in the selected years that have coordinates/i),
    ).toBeInTheDocument();
  });

  it("says the layer is an association, not a cause", async () => {
    render(
      <Providers>
        <EnableLayer />
        <TractBurdenLegend />
      </Providers>,
    );
    expect(
      await screen.findByText(/an association, not a cause/i),
    ).toBeInTheDocument();
  });

  it("explains the outlined top-CalEnviroScreen-quartile tracts", async () => {
    render(
      <Providers>
        <EnableLayer />
        <TractBurdenLegend />
      </Providers>,
    );
    expect(
      await screen.findByText(/top CalEnviroScreen quartile/i),
    ).toBeInTheDocument();
  });

  it("labels the ramp as a rate when CES supplied tract populations", async () => {
    render(
      <Providers>
        <EnableLayer />
        <TractBurdenLegend />
      </Providers>,
    );
    expect(
      await screen.findByText("crashes per 1,000 residents"),
    ).toBeInTheDocument();
  });

  it("falls back to raw counts when no tract had a population", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...BODY,
        summary: { ...BODY.summary, population_available: false },
      }),
    })) as unknown as typeof fetch;

    render(
      <Providers>
        <EnableLayer />
        <TractBurdenLegend />
      </Providers>,
    );
    expect(await screen.findByText("crashes")).toBeInTheDocument();
    expect(screen.queryByText("crashes per 1,000 residents")).toBeNull();
  });
});
