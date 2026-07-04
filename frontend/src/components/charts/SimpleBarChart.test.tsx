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
});
