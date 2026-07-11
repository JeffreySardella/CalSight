import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import JargonTerm from "./JargonTerm";

describe("JargonTerm", () => {
  it("renders the term as a keyboard-focusable button with no tooltip initially", () => {
    render(<JargonTerm term="SWITRS">SWITRS</JargonTerm>);
    const button = screen.getByRole("button", { name: "SWITRS" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button"); // never submits a form
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("shows the definition tooltip on keyboard focus with correct aria wiring", () => {
    render(<JargonTerm term="SWITRS">SWITRS</JargonTerm>);
    const button = screen.getByRole("button", { name: "SWITRS" });

    fireEvent.focus(button);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(/Statewide Integrated Traffic Records System/i);
    // aria-describedby must point at the tooltip element's id.
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("hides the tooltip on blur", () => {
    render(<JargonTerm term="KSI" />);
    const button = screen.getByRole("button", { name: "KSI" });

    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("shows the tooltip on click/tap (touch-friendly)", () => {
    render(<JargonTerm term="CCRS">CCRS</JargonTerm>);
    fireEvent.click(screen.getByRole("button", { name: "CCRS" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(/California Crash Reporting System/i);
  });

  it("dismisses the tooltip on Escape", () => {
    render(<JargonTerm term="AADT" />);
    const button = screen.getByRole("button", { name: "AADT" });

    fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("defaults the visible text to the term when no children are given", () => {
    render(<JargonTerm term="VMT" />);
    expect(screen.getByRole("button", { name: "VMT" })).toBeInTheDocument();
  });

  it("covers the full built-in glossary", () => {
    const terms = ["SWITRS", "CCRS", "KSI", "AADT", "CalEnviroScreen", "CES", "ACS", "FARS", "VMT", "PDO"] as const;
    for (const term of terms) {
      const { unmount } = render(<JargonTerm term={term} />);
      fireEvent.focus(screen.getByRole("button", { name: term }));
      expect(screen.getByRole("tooltip").textContent?.length ?? 0).toBeGreaterThan(20);
      unmount();
    }
  });
});
