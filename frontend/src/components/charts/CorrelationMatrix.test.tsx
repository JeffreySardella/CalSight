import { type ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../../context/ThemeContext";
import { CustomThemeProvider } from "../../context/CustomThemeContext";
import CorrelationMatrix from "./CorrelationMatrix";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});
globalThis.ResizeObserver = class {
  observe() {} unobserve() {} disconnect() {}
};

const render = (ui: ReactNode) =>
  rtlRender(<ThemeProvider><CustomThemeProvider>{ui}</CustomThemeProvider></ThemeProvider>);

const fields = [
  { key: "rate", label: "Crash Rate", source: "x" },
  { key: "pov", label: "Poverty", source: "y" },
];
// Asymmetric off-diagonals so each r-value string is unique in the DOM.
const matrix = [
  [1, 0.42],
  [0.37, 1],
];

describe("CorrelationMatrix accessibility", () => {
  it("exposes the matrix as an accessible table (role=img flattened the SVG cells)", () => {
    render(<CorrelationMatrix fields={fields} matrix={matrix} countyCount={58} />);

    const table = screen.getByRole("table", { name: /correlation matrix/i });
    expect(within(table).getByRole("columnheader", { name: "Poverty" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Crash Rate" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "0.42" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "0.37" })).toBeInTheDocument();
  });
});
