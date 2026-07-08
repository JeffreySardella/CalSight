import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
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

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateSpy };
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

const slot: ChartSlot = {
  id: "c1",
  dimension: "year",
  measure: "count",
  chartType: "bar",
  order: 0,
};

const data = [
  { label: "2022", value: 10 },
  { label: "2023", value: 20 },
];

function renderCard(url: string) {
  return render(
    <ThemeProvider>
      <CustomThemeProvider>
        <MemoryRouter initialEntries={[url]}>
          <ChartCard slot={slot} data={data} editing={false} />
        </MemoryRouter>
      </CustomThemeProvider>
    </ThemeProvider>,
  );
}

describe("ChartCard Explain navigation", () => {
  beforeEach(() => navigateSpy.mockClear());

  it("carries the active filter query string to /ask so the AI explains the filtered chart", async () => {
    renderCard("/stats?severity=fatal&cause=dui&year=2023&drill_county=fresno");
    await userEvent.click(screen.getByRole("button", { name: /^explain crashes by year/i }));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const target = new URL(navigateSpy.mock.calls[0][0], "http://localhost");
    expect(target.pathname).toBe("/ask");
    expect(target.searchParams.get("q")).toMatch(/Crashes by Year/);
    // Active filters carry over so useAskAi sends them with the question.
    expect(target.searchParams.get("severity")).toBe("fatal");
    expect(target.searchParams.get("cause")).toBe("dui");
    expect(target.searchParams.get("year")).toBe("2023");
    // Stats-internal params are not filters and must not leak.
    expect(target.searchParams.get("drill_county")).toBeNull();
  });

  it("navigates with only q when no filters are active", async () => {
    renderCard("/stats");
    await userEvent.click(screen.getByRole("button", { name: /^explain crashes by year/i }));

    const target = new URL(navigateSpy.mock.calls[0][0], "http://localhost");
    expect(target.pathname).toBe("/ask");
    expect(target.searchParams.get("q")).toMatch(/Crashes by Year/);
    expect([...target.searchParams.keys()]).toEqual(["q"]);
  });
});
