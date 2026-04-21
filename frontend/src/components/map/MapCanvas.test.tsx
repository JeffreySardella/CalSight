import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("leaflet", () => import("../../__mocks__/leaflet"));
vi.mock("react-leaflet", () => import("../../__mocks__/react-leaflet"));
vi.mock("./CountyBoundaries", () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="county-boundaries" data-focused={props.focusedCounty} />
  ),
}));

import type { Map as LeafletMap } from "leaflet";
import MapCanvas from "./MapCanvas";
import { mockMapInstance } from "../../__mocks__/leaflet";
import { ThemeProvider } from "../../context/ThemeContext";

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("MapCanvas", () => {
  let onMapReady: ReturnType<typeof vi.fn<(map: LeafletMap) => void>>;
  let onFocusCounty: ReturnType<typeof vi.fn<(name: string | null) => void>>;
  let onSelectCounty: ReturnType<typeof vi.fn<(name: string) => void>>;

  beforeEach(() => {
    onMapReady = vi.fn<(map: LeafletMap) => void>();
    onFocusCounty = vi.fn<(name: string | null) => void>();
    onSelectCounty = vi.fn<(name: string) => void>();
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    renderWithTheme(
      <MapCanvas
        focusedCounty={null}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onMapReady={onMapReady}
      />
    );
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
  });

  it("calls onMapReady with the map instance", () => {
    renderWithTheme(
      <MapCanvas
        focusedCounty={null}
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onMapReady={onMapReady}
      />
    );
    expect(onMapReady).toHaveBeenCalledWith(mockMapInstance);
  });

  it("passes focusedCounty to CountyBoundaries", () => {
    renderWithTheme(
      <MapCanvas
        focusedCounty="Fresno"
        onFocusCounty={onFocusCounty}
        onSelectCounty={onSelectCounty}
        onMapReady={onMapReady}
      />
    );
    const boundaries = screen.getByTestId("county-boundaries");
    expect(boundaries).toHaveAttribute("data-focused", "Fresno");
  });
});
