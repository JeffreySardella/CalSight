import { type ReactNode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

// ── Single-select segmented controls (M-F18) ──────────────────────────
// These groups previously conveyed the active choice by background colour
// only, with no group semantics or pressed state for assistive tech.

describe("LayersPanel segmented-control accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("names the Measure group and marks the active option pressed", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: /measure/i });
    expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);

    const unpressed = within(group).getAllByRole("button", { pressed: false })[0];
    fireEvent.click(unpressed);
    expect(unpressed).toHaveAttribute("aria-pressed", "true");
    // Still exactly one selected.
    expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("names the Color palette group and marks the active swatch pressed", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: /palette/i });
    expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("exposes the heatmap Resolution group once the statewide layer is on", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("switch", { name: "Statewide" }));
    const group = screen.getByRole("group", { name: /resolution/i });
    expect(within(group).getAllByRole("button", { pressed: true })).toHaveLength(1);
  });
});

// ── Water / reservoirs section (soft-launch gate) ──────────────────────
// The section is guarded by WATER_PAGE_PUBLIC (false while the Water page
// is soft-launched); this file runs against the real config, so the panel
// must not advertise the layer. The flag-up behavior is covered by
// ReservoirLayer.test.tsx, which mocks the flag on.

describe("LayersPanel — Water section soft-launch gate", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hides the Reservoirs toggle while WATER_PAGE_PUBLIC is false", () => {
    render(<Harness />);
    expect(screen.queryByRole("switch", { name: "Reservoirs" })).not.toBeInTheDocument();
    expect(screen.queryByText("Water")).not.toBeInTheDocument();
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
