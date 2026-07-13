import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Footer from "./Footer";

function renderFooter() {
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>,
  );
}

describe("Footer", () => {
  it("shows the government non-affiliation disclaimer on every page (#291)", () => {
    renderFooter();
    const disclaimer = screen.getByText(/independent project and is not affiliated/i);
    expect(disclaimer.textContent).toMatch(/California Highway Patrol/);
    expect(disclaimer.textContent).toMatch(/Caltrans/);
    expect(disclaimer.textContent).toMatch(/State of California/);
  });

  it("links to the Privacy Policy", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: /privacy policy/i });
    expect(link).toHaveAttribute("href", "/privacy");
  });

  it("links to the Terms of Service", () => {
    renderFooter();
    const link = screen.getByRole("link", { name: /terms of service/i });
    expect(link).toHaveAttribute("href", "/terms");
  });

  it("shows the current year in the copyright notice (D-5)", () => {
    renderFooter();
    const year = String(new Date().getFullYear());
    const notice = screen.getByText(new RegExp(`©\\s*${year} CalSight`));
    expect(notice).toBeInTheDocument();
  });
});
