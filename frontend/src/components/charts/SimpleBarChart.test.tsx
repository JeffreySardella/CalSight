import { type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, cleanup } from "@testing-library/react";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import { ThemeProvider } from "../../context/ThemeContext";
import SimpleBarChart from "./SimpleBarChart";

const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider>
      <CustomThemeProvider>{ui}</CustomThemeProvider>
    </ThemeProvider>,
  );

// jsdom lacks these; SimpleBarChart reads matchMedia (reduced-motion) and
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
  { label: "Mon", value: 10 },
  { label: "Tue", value: 20 },
];

beforeEach(() => cleanup());

describe("SimpleBarChart keyboard accessibility", () => {
  // role="img" makes an SVG's whole subtree presentational, so the role="button"
  // bars would be hidden from screen readers. When interactive the chart must be
  // a group (name preserved) so the buttons are actually exposed.
  it("uses role=group (not img) when bars are interactive", () => {
    render(<SimpleBarChart data={data} onBarClick={() => {}} />);
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("uses role=img for a non-interactive (decorative) chart", () => {
    render(<SimpleBarChart data={data} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("exposes clickable bars as focusable buttons with a data label", () => {
    render(<SimpleBarChart data={data} onBarClick={() => {}} />);
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: /Mon: 10/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tue: 20/ })).toBeInTheDocument();
  });

  it("activates a bar with Enter and Space", () => {
    const onBarClick = vi.fn();
    render(<SimpleBarChart data={data} onBarClick={onBarClick} />);
    const bars = screen.getAllByRole("button");

    fireEvent.keyDown(bars[1], { key: "Enter" });
    expect(onBarClick).toHaveBeenCalledWith(data[1], 1);

    fireEvent.keyDown(bars[0], { key: " " });
    expect(onBarClick).toHaveBeenCalledWith(data[0], 0);
    expect(onBarClick).toHaveBeenCalledTimes(2);
  });

  it("does not make bars interactive when there is no click handler", () => {
    render(<SimpleBarChart data={data} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("supports the same keyboard affordance in horizontal layout", () => {
    const onBarClick = vi.fn();
    render(<SimpleBarChart data={data} layout="horizontal" onBarClick={onBarClick} />);
    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(2);
    fireEvent.keyDown(bars[0], { key: "Enter" });
    expect(onBarClick).toHaveBeenCalledWith(data[0], 0);
  });

  it("moves focus between bars with arrow keys and Home/End", () => {
    render(<SimpleBarChart data={data} onBarClick={() => {}} />);
    const bars = screen.getAllByRole("button");
    (bars[0] as unknown as { focus(): void }).focus();

    fireEvent.keyDown(bars[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(bars[1]);

    fireEvent.keyDown(bars[1], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(bars[0]);

    fireEvent.keyDown(bars[0], { key: "End" });
    expect(document.activeElement).toBe(bars[1]);

    fireEvent.keyDown(bars[1], { key: "Home" });
    expect(document.activeElement).toBe(bars[0]);
  });

  it("clamps arrow-key navigation at the ends", () => {
    render(<SimpleBarChart data={data} onBarClick={() => {}} />);
    const bars = screen.getAllByRole("button");
    (bars[0] as unknown as { focus(): void }).focus();
    fireEvent.keyDown(bars[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(bars[0]);

    fireEvent.keyDown(bars[0], { key: "End" });
    fireEvent.keyDown(bars[1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(bars[1]);
  });
});

describe("SimpleBarChart tooltip bounds safety", () => {
  const tip = (item: { label: string; value: number }) => <span>tip-{item.label}</span>;

  it("does not render the tooltip for a stale hover index after data shrinks", () => {
    const three = [
      { label: "A", value: 1 },
      { label: "B", value: 2 },
      { label: "C", value: 3 },
    ];
    const { container, rerender } = rtlRender(
      <ThemeProvider>
        <CustomThemeProvider>
          <SimpleBarChart data={three} renderTooltip={tip} />
        </CustomThemeProvider>
      </ThemeProvider>,
    );
    const rects = container.querySelectorAll("rect");
    fireEvent.mouseMove(rects[2], { clientX: 100, clientY: 50 });
    expect(screen.getByText("tip-C")).toBeInTheDocument();

    // Shrink the data while hover still points at index 2 — must not throw
    // and must not call renderTooltip with undefined.
    expect(() =>
      rerender(
        <ThemeProvider>
          <CustomThemeProvider>
            <SimpleBarChart data={[{ label: "A", value: 1 }]} renderTooltip={tip} />
          </CustomThemeProvider>
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(screen.queryByText("tip-C")).toBeNull();
  });
});
