import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TermsPage from "./TermsPage";

describe("TermsPage", () => {
  it("renders the heading and last-updated date", () => {
    render(<TermsPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /terms of service/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last updated: July 10, 2026/i)).toBeInTheDocument();
  });

  it("discloses that data is provided as-is from public sources", () => {
    render(<TermsPage />);
    expect(
      screen.getByRole("heading", { name: /data is provided as-is/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /no warranty/i })).toBeInTheDocument();
    // Names the actual public sources rather than a vague claim.
    expect(screen.getByRole("button", { name: "SWITRS" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CCRS" })).toBeInTheDocument();
  });

  it("warns that AI-generated content may be inaccurate and is not professional advice", () => {
    render(<TermsPage />);
    expect(
      screen.getByText(/AI-generated text can be inaccurate, incomplete, or misleading/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not professional, legal, medical, engineering, or safety advice/i),
    ).toBeInTheDocument();
  });

  it("states non-affiliation with CHP, Caltrans, and the DMV", () => {
    render(<TermsPage />);
    const section = screen.getByText(/not affiliated with, endorsed by, or/i);
    expect(section.textContent).toMatch(/California Highway Patrol/);
    expect(section.textContent).toMatch(/Caltrans/);
    expect(section.textContent).toMatch(/DMV/);
  });

  it("includes acceptable use, limitation of liability, and changes sections", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: /acceptable use/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /limitation of liability/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /changes to these terms/i })).toBeInTheDocument();
  });

  it("links to the privacy policy", () => {
    render(<TermsPage />);
    const link = screen.getByRole("link", { name: /privacy policy/i });
    expect(link).toHaveAttribute("href", "/privacy");
  });
});
