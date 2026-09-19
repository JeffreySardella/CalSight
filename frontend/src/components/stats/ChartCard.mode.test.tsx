import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../../context/ThemeContext";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import ChartCard from "./ChartCard";
import { MODE_COVERAGE_NOTE, type ChartSlot } from "../../lib/dashboard/types";

// jsdom lacks matchMedia; ThemeProvider and chart components read it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = "";
  thresholds = [];
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

function renderCard(slot: ChartSlot, data: { label: string; value: number }[]) {
  return render(
    <ThemeProvider>
      <CustomThemeProvider>
        <MemoryRouter initialEntries={["/stats"]}>
          <ChartCard slot={slot} data={data} editing={false} />
        </MemoryRouter>
      </CustomThemeProvider>
    </ThemeProvider>,
  );
}

const modeSlot: ChartSlot = { id: "m1", dimension: "mode", measure: "count", chartType: "bar", order: 0 };
const MODE_DATA = [
  { label: "Vehicle Occupant", value: 900 },
  { label: "Pedestrian", value: 140 },
];

describe("ChartCard mode-coverage annotation", () => {
  it("footnotes the 2016 CCRS start on mode charts", () => {
    renderCard(modeSlot, MODE_DATA);
    expect(screen.getByText(MODE_COVERAGE_NOTE)).toBeInTheDocument();
  });

  it("asterisks the title so the footnote has something to attach to", () => {
    renderCard(modeSlot, MODE_DATA);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/\*$/);
  });

  it("drops the asterisk with the footnote when the chart is empty", () => {
    // The normal result when a filter the mode view cannot answer is active:
    // /api/stats/batch returns the in-band error object and the card renders
    // empty. An asterisk with no footnote under it is worse than neither.
    renderCard(modeSlot, []);
    expect(screen.queryByText(/Mode data starts/)).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).textContent).not.toMatch(/\*$/);
  });

  it("leaves other dimensions alone", () => {
    renderCard({ ...modeSlot, dimension: "county" }, [{ label: "Kern", value: 12 }]);
    expect(screen.queryByText(/Mode data starts/)).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).textContent).not.toMatch(/\*$/);
  });
});
