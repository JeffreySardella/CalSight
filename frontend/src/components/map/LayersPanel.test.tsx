import { type ReactNode } from "react";
import { describe, it, expect } from "vitest";
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

function TopIntersectionsProbe() {
  const { otherLayers } = useLayersState();
  return <div data-testid="ti-state">{String(otherLayers.topIntersections)}</div>;
}

describe("LayersPanel — Top intersections toggle", () => {
  it("shows the neutral toggle row", () => {
    render(
      <Providers>
        <LayersPanel />
      </Providers>,
    );
    expect(screen.getByText("Top intersections")).toBeInTheDocument();
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

    const row = screen.getByText("Top intersections").parentElement as HTMLElement;
    const toggle = within(row).getByRole("button");
    fireEvent.click(toggle);

    expect(screen.getByTestId("ti-state").textContent).toBe("true");
  });
});
