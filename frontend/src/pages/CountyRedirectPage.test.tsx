import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CountyRedirectPage from "./CountyRedirectPage";

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/county/${slug}`]}>
      <Routes>
        <Route path="/county/:slug" element={<CountyRedirectPage />} />
        <Route path="/county/:slug/report" element={<div>report for {slug}</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CountyRedirectPage", () => {
  it("redirects a valid county slug to its report card", () => {
    renderAt("fresno");
    expect(screen.getByText(/report for/)).toBeInTheDocument();
  });

  it("is case-insensitive on the slug", () => {
    renderAt("Fresno");
    expect(screen.getByText(/report for/)).toBeInTheDocument();
  });

  it("shows the normal not-found page for an invalid slug", () => {
    renderAt("not-a-real-county");
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });
});
