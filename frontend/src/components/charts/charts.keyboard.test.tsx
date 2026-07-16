import { type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, cleanup } from "@testing-library/react";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import { nextChartIndex } from "./chartKeyboardNav";
import DualAxisLineChart from "./DualAxisLineChart";
import SimpleDonutChart from "./SimpleDonutChart";
import SimpleLollipop from "./SimpleLollipop";
import SimplePolarArea from "./SimplePolarArea";
import SimpleRadar from "./SimpleRadar";
import SimpleScatter from "./SimpleScatter";
import SimpleTreemap from "./SimpleTreemap";

const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider>
      <CustomThemeProvider>{ui}</CustomThemeProvider>
    </ThemeProvider>,
  );

// jsdom lacks these; charts read matchMedia (reduced-motion) and observe
// their size/visibility on mount.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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

beforeEach(() => cleanup());

describe("nextChartIndex", () => {
  it("steps forward and backward with clamping", () => {
    expect(nextChartIndex("ArrowRight", null, 3)).toBe(0);
    expect(nextChartIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextChartIndex("ArrowRight", 2, 3)).toBe(2);
    expect(nextChartIndex("ArrowLeft", null, 3)).toBe(2);
    expect(nextChartIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(nextChartIndex("ArrowLeft", 0, 3)).toBe(0);
  });

  it("treats ArrowDown/ArrowUp as aliases and supports Home/End", () => {
    expect(nextChartIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextChartIndex("ArrowUp", 1, 3)).toBe(0);
    expect(nextChartIndex("Home", 2, 3)).toBe(0);
    expect(nextChartIndex("End", 0, 3)).toBe(2);
  });

  it("ignores non-navigation keys and empty data", () => {
    expect(nextChartIndex("Enter", 0, 3)).toBeNull();
    expect(nextChartIndex("a", 0, 3)).toBeNull();
    expect(nextChartIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

const items = [
  { label: "Alpha", value: 10 },
  { label: "Beta", value: 20 },
  { label: "Gamma", value: 30 },
];

describe("chart keyboard accessibility (remaining chart types)", () => {
  it("SimpleScatter walks points and announces x/y values", () => {
    const { container } = render(
      <SimpleScatter data={items} title="Scatter" xLabel="Crashes" yLabel="Deaths" />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Alpha: Crashes 10, Deaths 0");

    fireEvent.keyDown(svg, { key: "End" });
    expect(status).toHaveTextContent("Gamma: Crashes 30, Deaths 0");

    fireEvent.blur(svg);
    expect(status).toBeEmptyDOMElement();
  });

  it("DualAxisLineChart announces both series and shows the tooltip", () => {
    const dual = [
      { label: "2021", primary: 100, secondary: 5 },
      { label: "2022", primary: 200, secondary: 7 },
    ];
    const { container } = render(
      <DualAxisLineChart
        data={dual}
        title="Dual"
        primaryLabel="Crashes"
        secondaryLabel="Rate"
        renderTooltip={(item) => <span>tip-{item.label}</span>}
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("2021: Crashes 100, Rate 5");
    expect(screen.getByText("tip-2021")).toBeInTheDocument();

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("2022: Crashes 200, Rate 7");

    fireEvent.blur(svg);
    expect(screen.queryByText("tip-2021")).toBeNull();
  });

  it("SimpleDonutChart walks segments with percentages and activates on Enter", () => {
    const onSegmentClick = vi.fn();
    const withColor = items.map((d) => ({ ...d, color: "#123456" }));
    const { container } = render(
      <SimpleDonutChart data={withColor} title="Donut" onSegmentClick={onSegmentClick} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Alpha: 10 (17%)");

    fireEvent.keyDown(svg, { key: "Enter" });
    expect(onSegmentClick).toHaveBeenCalledWith(withColor[0], 0);
  });

  it("SimpleLollipop walks rows and activates on Space", () => {
    const onItemClick = vi.fn();
    const { container } = render(
      <SimpleLollipop data={items} title="Lollipop" onItemClick={onItemClick} />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(status).toHaveTextContent("Alpha: 10");
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(status).toHaveTextContent("Beta: 20");

    fireEvent.keyDown(svg, { key: " " });
    expect(onItemClick).toHaveBeenCalledWith(items[1], 1);
  });

  it("SimplePolarArea walks slices and announces values", () => {
    const { container } = render(<SimplePolarArea data={items} title="Polar" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Alpha: 10");
    fireEvent.keyDown(svg, { key: "End" });
    expect(status).toHaveTextContent("Gamma: 30");
  });

  it("SimpleRadar walks vertices and announces values", () => {
    const { container } = render(<SimpleRadar data={items} title="Radar" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Alpha: 10");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(status).toHaveTextContent("Alpha: 10");
  });

  it("SimpleTreemap walks tiles in data order with percentages", () => {
    const { container } = render(<SimpleTreemap data={items} title="Treemap" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("tabindex", "0");
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Alpha: 10 (17%)");
    fireEvent.keyDown(svg, { key: "End" });
    expect(status).toHaveTextContent("Gamma: 30 (50%)");
  });

  it("keeps the tooltip guarded when data shrinks under a keyboard-focused index", () => {
    const tip = (item: { label: string; value: number }) => <span>tip-{item.label}</span>;
    const { container, rerender } = rtlRender(
      <ThemeProvider>
        <CustomThemeProvider>
          <SimpleLollipop data={items} renderTooltip={tip} />
        </CustomThemeProvider>
      </ThemeProvider>,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByText("tip-Gamma")).toBeInTheDocument();

    expect(() =>
      rerender(
        <ThemeProvider>
          <CustomThemeProvider>
            <SimpleLollipop data={[items[0]]} renderTooltip={tip} />
          </CustomThemeProvider>
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(screen.queryByText("tip-Gamma")).toBeNull();
  });
});
