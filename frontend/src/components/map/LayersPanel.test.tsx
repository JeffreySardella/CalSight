import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LayersStateProvider } from "../../hooks/useLayersState";
import { ThemeProvider } from "../../context/ThemeContext";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import LayersPanel from "./LayersPanel";

function Harness() {
  return (
    <ThemeProvider>
      <CustomThemeProvider>
        <LayersStateProvider>
          <LayersPanel />
        </LayersStateProvider>
      </CustomThemeProvider>
    </ThemeProvider>
  );
}

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
