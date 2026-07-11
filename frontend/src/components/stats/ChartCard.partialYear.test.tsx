import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "../../context/ThemeContext";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import ChartCard from "./ChartCard";
import type { ChartSlot } from "../../lib/dashboard/types";

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

const CURRENT = new Date().getFullYear();

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

const yearSlot: ChartSlot = { id: "c1", dimension: "year", measure: "count", chartType: "bar", order: 0 };

describe("ChartCard partial-year annotation", () => {
  it("annotates year charts that include the current (partial) year", () => {
    renderCard(yearSlot, [
      { label: String(CURRENT - 1), value: 10 },
      { label: String(CURRENT), value: 4 },
    ]);
    expect(screen.getByText(`${CURRENT} is partial-year data`)).toBeInTheDocument();
  });

  it("shows no annotation when only complete years are charted", () => {
    renderCard(yearSlot, [
      { label: String(CURRENT - 2), value: 10 },
      { label: String(CURRENT - 1), value: 12 },
    ]);
    expect(screen.queryByText(/partial-year data/)).toBeNull();
  });

  it("shows no annotation on non-year dimensions", () => {
    const countySlot: ChartSlot = { ...yearSlot, dimension: "county" };
    renderCard(countySlot, [
      { label: "Fresno", value: 10 },
      { label: "Kern", value: 12 },
    ]);
    expect(screen.queryByText(/partial-year data/)).toBeNull();
  });
});
