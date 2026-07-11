import { type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, act, cleanup } from "@testing-library/react";
import InlineChart from "./InlineChart";
import { ThemeProvider } from "../../context/ThemeContext";
import {
  setPreferences,
  __resetPreferencesForTests,
} from "../../hooks/useUserPreferences";
import type { ChartData } from "../../hooks/useAskAi";

// Isolate from chart library internals (ResizeObserver, canvas, animation).
// The bar mock surfaces the color InlineChart resolved so theme reactivity
// can be asserted.
vi.mock("../charts/SimpleBarChart", () => ({
  default: ({ defaultColor }: { defaultColor?: string }) => (
    <div data-testid="bar-chart" data-color={defaultColor} />
  ),
}));
vi.mock("../charts/SimpleLineChart", () => ({ default: () => <div data-testid="line-chart" /> }));
vi.mock("../charts/SimpleDonutChart", () => ({ default: () => <div data-testid="donut-chart" /> }));

const render = (ui: ReactNode) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);

const barChart: ChartData = {
  type: "bar",
  title: "Test Chart",
  data: [{ label: "A", value: 1 }],
};

const LIGHT_FIRST = "#4a7a8c";
const DARK_FIRST = "#6b8fa3";

beforeEach(() => {
  cleanup();
  act(() => __resetPreferencesForTests());
});

describe("InlineChart forceLight", () => {
  it("uses light (bg-gray-100) tile class when forceLight is true", () => {
    const { container } = render(<InlineChart chart={barChart} forceLight />);
    expect(container.querySelector(".bg-gray-100")).not.toBeNull();
  });

  it("uses surface-container tile class when forceLight is false (default)", () => {
    const { container } = render(<InlineChart chart={barChart} />);
    expect(container.querySelector(".bg-surface-container")).not.toBeNull();
  });

  it("keeps the light palette in dark mode when forceLight is set", () => {
    act(() => setPreferences({ theme: "dark" }));
    const { getByTestId } = render(<InlineChart chart={barChart} forceLight />);
    expect(getByTestId("bar-chart").dataset.color).toBe(LIGHT_FIRST);
  });
});

describe("InlineChart theme reactivity", () => {
  it("re-resolves colors when the theme changes after mount", () => {
    const { getByTestId } = render(<InlineChart chart={barChart} />);
    expect(getByTestId("bar-chart").dataset.color).toBe(LIGHT_FIRST);

    act(() => setPreferences({ theme: "dark" }));
    expect(getByTestId("bar-chart").dataset.color).toBe(DARK_FIRST);

    act(() => setPreferences({ theme: "light" }));
    expect(getByTestId("bar-chart").dataset.color).toBe(LIGHT_FIRST);
  });
});
