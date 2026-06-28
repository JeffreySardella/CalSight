import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import InlineChart from "./InlineChart";
import type { ChartData } from "../../hooks/useAskAi";

// Isolate from chart library internals (ResizeObserver, canvas, animation)
vi.mock("../charts/SimpleBarChart", () => ({ default: () => <div data-testid="bar-chart" /> }));
vi.mock("../charts/SimpleLineChart", () => ({ default: () => <div data-testid="line-chart" /> }));
vi.mock("../charts/SimpleDonutChart", () => ({ default: () => <div data-testid="donut-chart" /> }));

const barChart: ChartData = {
  type: "bar",
  title: "Test Chart",
  data: [{ label: "A", value: 1 }],
};

describe("InlineChart forceLight", () => {
  it("uses light (bg-gray-100) tile class when forceLight is true", () => {
    const { container } = render(<InlineChart chart={barChart} forceLight />);
    expect(container.firstElementChild?.className).toContain("bg-gray-100");
  });

  it("uses surface-container tile class when forceLight is false (default)", () => {
    const { container } = render(<InlineChart chart={barChart} />);
    expect(container.firstElementChild?.className).toContain("bg-surface-container");
  });
});
