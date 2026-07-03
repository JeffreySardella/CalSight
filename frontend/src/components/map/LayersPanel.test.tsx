import { type ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayersStateProvider, useLayersState } from "../../hooks/useLayersState";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import { MemoryRouter } from "react-router-dom";
import LayersPanel from "./LayersPanel";

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <CustomThemeProvider>
          <LayersStateProvider>{children}</LayersStateProvider>
        </CustomThemeProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function Harness() {
  return (
    <Providers>
      <LayersPanel />
    </Providers>
  );
}

// ── Toggle accessibility (from the audit's H-F11 fix) ──────────────────

describe("LayersPanel toggle accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exposes every layer toggle as a named switch", () => {
    render(<Harness />);
    for (const name of [
      "Shade by Measure",
      "Statewide",
      "County Detail",
      "Coord Mismatches",
      "Hide River Crashes",
      "Highway Danger",
      "Top intersections",
    ]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument();
    }
  });

  it("reflects state via aria-checked and flips it on toggle", () => {
    render(<Harness />);
    const highway = screen.getByRole("switch", { name: "Highway Danger" });
    expect(highway).toHaveAttribute("aria-checked", "false");
    fireEvent.click(highway);
    expect(highway).toHaveAttribute("aria-checked", "true");
    fireEvent.click(highway);
    expect(highway).toHaveAttribute("aria-checked", "false");
  });

  it("marks the sole active base layer as aria-disabled with an sr-only explanation", () => {
    render(<Harness />);
    // Defaults: choropleth on, statewide heatmap off — choropleth is locked.
    const choropleth = screen.getByRole("switch", { name: "Shade by Measure" });
    expect(choropleth).toHaveAttribute("aria-disabled", "true");
    expect(choropleth).toHaveTextContent(/at least one base layer must be active/i);

    // Clicking a locked toggle is a no-op.
    fireEvent.click(choropleth);
    expect(choropleth).toHaveAttribute("aria-checked", "true");
  });

  it("moves the lock to the statewide heatmap when it becomes the sole base layer", () => {
    render(<Harness />);
    const statewide = screen.getByRole("switch", { name: "Statewide" });
    expect(statewide).not.toHaveAttribute("aria-disabled");
    fireEvent.click(statewide);

    expect(statewide).toHaveAttribute("aria-checked", "true");
    expect(statewide).toHaveAttribute("aria-disabled", "true");
    const choropleth = screen.getByRole("switch", { name: "Shade by Measure" });
    expect(choropleth).toHaveAttribute("aria-checked", "false");
    expect(choropleth).not.toHaveAttribute("aria-disabled");
  });
});

// ── Top intersections toggle (from #349 street-level work) ─────────────

function TopIntersectionsProbe() {
  const { otherLayers } = useLayersState();
  return <div data-testid="ti-state">{String(otherLayers.topIntersections)}</div>;
}

describe("LayersPanel — Top intersections toggle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the neutral toggle row", () => {
    render(<Harness />);
    expect(screen.getByRole("switch", { name: "Top intersections" })).toBeInTheDocument();
    expect(screen.getByText("Ranked by severity")).toBeInTheDocument();
  });

  it("flips topIntersections when clicked", () => {
    render(
      <Providers>
        <TopIntersectionsProbe />
        <LayersPanel />
      </Providers>,
    );
    expect(screen.getByTestId("ti-state").textContent).toBe("false");

    fireEvent.click(screen.getByRole("switch", { name: "Top intersections" }));

    expect(screen.getByTestId("ti-state").textContent).toBe("true");
  });
});
