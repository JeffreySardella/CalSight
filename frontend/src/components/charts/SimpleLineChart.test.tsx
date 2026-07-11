import { type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, cleanup } from "@testing-library/react";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import SimpleLineChart from "./SimpleLineChart";

const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider>
      <CustomThemeProvider>{ui}</CustomThemeProvider>
    </ThemeProvider>,
  );

// jsdom lacks these; SimpleLineChart reads matchMedia (reduced-motion) and
// observes its size on mount.
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

const data = [
  { label: "Jan", value: 10 },
  { label: "Feb", value: 20 },
  { label: "Mar", value: 30 },
];

beforeEach(() => cleanup());

describe("SimpleLineChart keyboard accessibility", () => {
  it("exposes a focusable chart", () => {
    const { container } = render(<SimpleLineChart data={data} title="Trend" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("tabindex", "0");
  });

  it("walks data points with arrow keys and announces them via the live region", () => {
    const { container } = render(<SimpleLineChart data={data} title="Trend" />);
    const svg = container.querySelector("svg")!;
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Jan: 10");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Feb: 20");

    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(status).toHaveTextContent("Jan: 10");

    fireEvent.keyDown(svg, { key: "End" });
    expect(status).toHaveTextContent("Mar: 30");

    fireEvent.keyDown(svg, { key: "Home" });
    expect(status).toHaveTextContent("Jan: 10");
  });

  it("clamps arrow-key navigation at the ends", () => {
    const { container } = render(<SimpleLineChart data={data} title="Trend" />);
    const svg = container.querySelector("svg")!;
    const status = screen.getByRole("status");

    fireEvent.keyDown(svg, { key: "Home" });
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(status).toHaveTextContent("Jan: 10");

    fireEvent.keyDown(svg, { key: "End" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(status).toHaveTextContent("Mar: 30");
  });

  it("shows the tooltip for the keyboard-focused point", () => {
    const { container } = render(
      <SimpleLineChart
        data={data}
        title="Trend"
        renderTooltip={(item) => <span>tip-{item.label}</span>}
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByText("tip-Jan")).toBeInTheDocument();

    fireEvent.blur(svg);
    expect(screen.queryByText("tip-Jan")).toBeNull();
  });
});

describe("SimpleLineChart tooltip bounds safety", () => {
  it("does not render the tooltip for a stale hover index after data shrinks", () => {
    const tip = (item: { label: string; value: number }) => <span>tip-{item.label}</span>;
    const { container, rerender } = rtlRender(
      <ThemeProvider>
        <CustomThemeProvider>
          <SimpleLineChart data={data} renderTooltip={tip} />
        </CustomThemeProvider>
      </ThemeProvider>,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByText("tip-Mar")).toBeInTheDocument();

    expect(() =>
      rerender(
        <ThemeProvider>
          <CustomThemeProvider>
            <SimpleLineChart data={[{ label: "Jan", value: 10 }]} renderTooltip={tip} />
          </CustomThemeProvider>
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(screen.queryByText("tip-Mar")).toBeNull();
  });
});
