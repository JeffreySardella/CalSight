import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { ThemeProvider } from "../../context/ThemeContext";
import ChoroplethLegend from "./ChoroplethLegend";
import { MEASURES } from "../../lib/choropleth/measures";

function Seeder({ edges, choroplethOn }: { edges: number[] | null; choroplethOn: boolean }) {
  const s = useLayersState();
  useEffect(() => { s.setBucketEdges(edges); }, [edges]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { s.setChoroplethOn(choroplethOn); }, [choroplethOn]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Harness({
  edges = null as number[] | null,
  demographicsAvailable = true,
  choroplethOn = true,
}) {
  return (
    <ThemeProvider>
      <LayersStateProvider>
        <Seeder edges={edges} choroplethOn={choroplethOn} />
        <ChoroplethLegend demographicsAvailable={demographicsAvailable} />
      </LayersStateProvider>
    </ThemeProvider>
  );
}

describe("ChoroplethLegend", () => {
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
      <ThemeProvider>
        <LayersStateProvider>
          <Probe />
          <ChoroplethLegend demographicsAvailable={true} />
        </LayersStateProvider>
      </ThemeProvider>,
    );
    const trigger = screen.getByLabelText(/measure/i);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /fatality rate/i }));
    expect(screen.getByTestId("current")).toHaveTextContent("fatality_rate");
  });

  it("shows an error message with retry button when isError is true", () => {
    const onRetry = vi.fn();
    render(
      <ThemeProvider>
        <LayersStateProvider>
          <ChoroplethLegend demographicsAvailable={true} isError={true} onRetry={onRetry} />
        </LayersStateProvider>
      </ThemeProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't load data/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows a 422 warning instead of the error message when is422 is true", () => {
    render(
      <ThemeProvider>
        <LayersStateProvider>
          <ChoroplethLegend demographicsAvailable={true} isError={true} is422={true} />
        </LayersStateProvider>
      </ThemeProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/filter value was rejected/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a loading skeleton when isLoading is true", () => {
    render(
      <ThemeProvider>
        <LayersStateProvider>
          <ChoroplethLegend demographicsAvailable={true} isLoading={true} />
        </LayersStateProvider>
      </ThemeProvider>,
    );
    expect(screen.getByText(/loading data/i)).toBeInTheDocument();
  });
});
