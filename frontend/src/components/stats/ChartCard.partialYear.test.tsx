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

describe("ChartCard KSI definition footnote", () => {
  const ksiSlot: ChartSlot = { ...yearSlot, measure: "ksi" };
  const years = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ label: String(from + i), value: 100 + i }));

  it("shows the footnote on a KSI year chart crossing 2015→2016", () => {
    renderCard(ksiSlot, years(2012, 2019));
    expect(screen.getByText(/^\* KSI = people killed or seriously injured/)).toBeInTheDocument();
  });

  it("hides it when the range crosses neither boundary", () => {
    renderCard(ksiSlot, years(2019, 2024));
    expect(screen.queryByText(/KSI = people killed/)).toBeNull();
  });

  it("hides it for non-KSI measures", () => {
    renderCard(yearSlot, years(2012, 2019));
    expect(screen.queryByText(/KSI = people killed/)).toBeNull();
  });

  it("shows it when KSI is the secondary measure", () => {
    renderCard({ ...yearSlot, chartType: "line", secondaryMeasure: "ksi" }, years(2012, 2019));
    expect(screen.getByText(/^\* KSI = people killed or seriously injured/)).toBeInTheDocument();
  });

  it("appends asterisk to the heading when the KSI footnote is shown", () => {
    const { container } = renderCard(ksiSlot, years(2012, 2019));
    const heading = container.querySelector(".chart-card-themed h3");
    expect(heading?.textContent).toMatch(/\*$/);
  });

  it("does not append asterisk to the heading when the KSI footnote is not shown", () => {
    const { container } = renderCard(ksiSlot, years(2019, 2024));
    const heading = container.querySelector(".chart-card-themed h3");
    expect(heading?.textContent).not.toMatch(/\*$/);
  });
});

describe("ChartCard preliminary-deaths footnote", () => {
  const killedSlot: ChartSlot = { ...yearSlot, measure: "killed" };
  // The previous year's deaths are provisional all through the current year.
  const recent = [
    { label: String(CURRENT - 3), value: 4011 },
    { label: String(CURRENT - 2), value: 4000 },
    { label: String(CURRENT - 1), value: 3407 },
  ];

  it("marks the provisional year on a deaths-by-year chart", () => {
    renderCard(killedSlot, recent);
    expect(screen.getByText(new RegExp(`^Deaths for ${CURRENT - 1} are preliminary`))).toBeInTheDocument();
  });

  it("also marks deaths per 1,000 crashes", () => {
    renderCard({ ...yearSlot, measure: "fatality_rate" }, recent);
    expect(screen.getByText(/are preliminary/)).toBeInTheDocument();
  });

  it("stays off crash-count charts", () => {
    renderCard(yearSlot, recent);
    expect(screen.queryByText(/are preliminary/)).toBeNull();
  });

  it("stays off when every charted year is settled", () => {
    renderCard(killedSlot, recent.slice(0, 2));
    expect(screen.queryByText(/are preliminary/)).toBeNull();
  });
});

describe("ChartCard single-point line", () => {
  it("shows the number instead of an invisible one-point line", () => {
    renderCard({ ...yearSlot, measure: "killed", chartType: "area" }, [{ label: "2025", value: 3407 }]);
    expect(screen.getByTestId("single-value")).toHaveTextContent("3,407");
    expect(screen.getByTestId("single-value")).toHaveTextContent("Fatalities, 2025");
  });
});
