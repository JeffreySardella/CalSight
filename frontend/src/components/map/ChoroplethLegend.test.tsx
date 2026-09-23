import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, type ComponentProps } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { ThemeProvider } from "../../context/ThemeContext";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import ChoroplethLegend from "./ChoroplethLegend";
import { MEASURES, type MeasureKey } from "../../lib/choropleth/measures";
import type { DataSummary } from "../../hooks/useChoroplethData";

function Seeder({ edges, choroplethOn }: { edges: number[] | null; choroplethOn: boolean }) {
  const s = useLayersState();
  useEffect(() => { s.setBucketEdges(edges); }, [edges]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { s.setChoroplethOn(choroplethOn); }, [choroplethOn]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function MeasureSetter({ measure }: { measure: MeasureKey }) {
  const s = useLayersState();
  useEffect(() => { s.setMeasure(measure); }, [measure]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const BASE_SUMMARY: DataSummary = { totalCrashes: 500_000, missingDemoYears: [], partialDemoYears: [], estimatedDemoYears: [], estimatedFromYears: [], sparseYears: [] };

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Harness({
  edges = null as number[] | null,
  demographicsAvailable = true,
  dataSummary = BASE_SUMMARY,
  choroplethOn = true,
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
          <LayersStateProvider>
            <Seeder edges={edges} choroplethOn={choroplethOn} />
            <ChoroplethLegend demographicsAvailable={demographicsAvailable} dataSummary={dataSummary} />
          </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function MeasureHarness({
  measure,
  edges = [0, 10, 20, 30, 40, 50],
  dataSummary = BASE_SUMMARY,
  ...props
}: { measure: MeasureKey; edges?: number[] } & Partial<ComponentProps<typeof ChoroplethLegend>>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
          <LayersStateProvider>
            <Seeder edges={edges} choroplethOn />
            <MeasureSetter measure={measure} />
            <ChoroplethLegend demographicsAvailable dataSummary={dataSummary} {...props} />
          </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe("ChoroplethLegend", () => {
  beforeEach(() => { localStorage.clear(); });
  it("renders the measure dropdown with all 5 options", async () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} />);
    const trigger = await screen.findByLabelText(/measure/i);
    fireEvent.click(trigger);
    for (const m of Object.values(MEASURES)) {
      expect(screen.getByRole("option", { name: m.label })).toBeInTheDocument();
    }
  });

  it("renders bucket edge labels formatted per measure", async () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} />);
    await waitFor(() => expect(screen.getByText("0")).toBeInTheDocument());
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("does not render when choroplethOn is false", async () => {
    const { container } = render(<Harness edges={[0, 1, 2, 3, 4, 5]} choroplethOn={false} />);
    await waitFor(() =>
      expect(container.querySelector("[data-testid='choropleth-legend']")).toBeNull()
    );
  });

  it("disables per-capita measures when demographics are unavailable", async () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} demographicsAvailable={false} />);
    const trigger = screen.getByLabelText(/measure/i);
    fireEvent.click(trigger);
    const perCapita = await screen.findByRole("option", { name: /crashes per 100k/i });
    expect(perCapita).toBeDisabled();
  });

  it("changing the dropdown updates layers state", () => {
    function Probe() {
      const s = useLayersState();
      return <div data-testid="current">{s.measure}</div>;
    }
    render(
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
        <LayersStateProvider>
          <Probe />
          <ChoroplethLegend demographicsAvailable={true} />
        </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    const trigger = screen.getByLabelText(/measure/i);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /fatality rate/i }));
    expect(screen.getByTestId("current")).toHaveTextContent("fatality_rate");
  });

  it("shows an error message with retry button when isError is true", () => {
    const onRetry = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
        <LayersStateProvider>
          <ChoroplethLegend demographicsAvailable={true} isError={true} onRetry={onRetry} />
        </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load data/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows a 422 warning instead of the error message when is422 is true", () => {
    render(
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
        <LayersStateProvider>
          <ChoroplethLegend demographicsAvailable={true} isError={true} is422={true} />
        </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/filter value was rejected/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a loading skeleton when isLoading is true", () => {
    render(
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
        <LayersStateProvider>
          <ChoroplethLegend demographicsAvailable={true} isLoading={true} />
        </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/loading data/i)).toBeInTheDocument();
  });

  it("shows the crash total under a count measure", () => {
    render(<MeasureHarness measure="crashes_raw" dataSummary={{ ...BASE_SUMMARY, totalCrashes: 1_200_000 }} />);
    expect(screen.getByTestId("data-summary")).toHaveTextContent(/1\.2M crashes/);
  });

  it("drops the crash total under a rate measure", () => {
    render(<MeasureHarness measure="fatalities_per_100k" dataSummary={{ ...BASE_SUMMARY, totalCrashes: 11_600_000 }} />);
    expect(screen.getByTestId("choropleth-legend")).not.toHaveTextContent(/11\.6M crashes/);
  });

  it("totals the selected counties, not the state", () => {
    render(<MeasureHarness measure="crashes_raw" dataSummary={{ ...BASE_SUMMARY, totalCrashes: 11_600_000 }} scopeCrashes={233_290} />);
    expect(screen.getByTestId("data-summary")).toHaveTextContent(/233K crashes/);
    expect(screen.getByTestId("choropleth-legend")).not.toHaveTextContent(/11\.6M/);
  });

  it("prints the break values under the ramp on a phone, in the measure's format", async () => {
    render(<MeasureHarness measure="fatality_rate" edges={[0.5, 0.8, 1, 1.2, 1.6, 2.4]} />);
    const breaks = await screen.findByTestId("legend-breaks");
    // Visible without expanding the phone card (no hidden wrapper around it).
    expect(breaks.closest(".hidden")).toBeNull();
    expect(breaks).toHaveTextContent("0.5%");
    expect(breaks).toHaveTextContent("2.4%");
  });

  it("reads the heat layer's coverage as crashes plotted out of crashes in scope", () => {
    render(
      <MeasureHarness
        measure="crashes_per_100k"
        scopeCrashes={233_290}
        heatmapCrashes={107_112}
        heatmapDisplayed={20_273}
      />,
    );
    // Grid cells (20,273) are not crashes; they used to be the numerator.
    expect(screen.getByTestId("heatmap-mapped")).toHaveTextContent("107K of 233K crashes mapped (46%)");
  });

  it("uses the same numerator and denominator once a county is focused", () => {
    render(
      <MeasureHarness
        measure="crashes_per_100k"
        countyActive
        scopeCrashes={233_290}
        heatmapCrashes={107_112}
        heatmapDisplayed={20_273}
      />,
    );
    expect(screen.getByTestId("heatmap-mapped")).toHaveTextContent("107K of 233K crashes mapped (46%)");
  });

  it("shows sparse year warning", () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} dataSummary={{ ...BASE_SUMMARY, sparseYears: [{ year: 2026, count: 487 }] }} />);
    expect(screen.getByTestId("data-summary")).toHaveTextContent(/2026: 487 crashes \(in progress\)/);
  });

  it("shows missing-demographics alert when per-capita measure is active and years are missing", async () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} dataSummary={{ ...BASE_SUMMARY, missingDemoYears: [2024, 2025] }} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no census data for 2024, 2025/i);
    expect(screen.getByRole("button", { name: /switch to total crashes/i })).toBeInTheDocument();
  });

  it("notes estimated population years, compressing long runs", () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} dataSummary={{ ...BASE_SUMMARY, estimatedDemoYears: [2001, 2002, 2003, 2004, 2024, 2025], estimatedFromYears: [2005, 2023] }} />);
    expect(screen.getByTestId("demo-estimate-note")).toHaveTextContent(
      "Population for 2001-2004, 2024, 2025 estimated from 2005, 2023 census data",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows partial-demographics alert for years with incomplete county coverage", async () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} dataSummary={{ ...BASE_SUMMARY, partialDemoYears: [2005, 2006, 2007, 2008, 2009] }} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/switch to total crashes/i);
  });

  it("shows both missing and partial alerts together", async () => {
    render(<Harness edges={[0, 10, 20, 30, 40, 50]} dataSummary={{ ...BASE_SUMMARY, missingDemoYears: [2024], partialDemoYears: [2007] }} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no census data for 2024/i);
  });

  it("does not show missing-demographics alert for raw measures", () => {
    render(
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
        <LayersStateProvider>
          <MeasureSetter measure="crashes_raw" />
          <ChoroplethLegend demographicsAvailable={true} dataSummary={{ ...BASE_SUMMARY, missingDemoYears: [2024] }} />
        </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches to crashes_raw when the quick-action button is clicked", async () => {
    function Probe() {
      const s = useLayersState();
      return <div data-testid="current">{s.measure}</div>;
    }
    render(
      <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomThemeProvider>
        <LayersStateProvider>
          <Probe />
          <ChoroplethLegend demographicsAvailable={true} dataSummary={{ ...BASE_SUMMARY, missingDemoYears: [2024] }} />
        </LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("current")).toHaveTextContent("crashes_per_100k");
    fireEvent.click(screen.getByRole("button", { name: /switch to total crashes/i }));
    expect(screen.getByTestId("current")).toHaveTextContent("crashes_raw");
  });
});
