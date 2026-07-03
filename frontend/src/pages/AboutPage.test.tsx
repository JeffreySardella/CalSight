import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AboutPage from "./AboutPage";

describe("AboutPage — data limitations", () => {
  it("discloses the pedestrian/bicyclist undercount with a source link", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/Pedestrian and bicyclist crashes are undercounted the most/i),
    ).toBeInTheDocument();
    // The claim carries a citation link, not a bare assertion.
    const link = screen.getByRole("link", { name: /Hospital-linkage study/i });
    expect(link).toHaveAttribute("href", "https://escholarship.org/uc/item/0jq5h6f5");
  });

  it("discloses the street-level grouping caveat", () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/Street-level grouping uses reported road names/i),
    ).toBeInTheDocument();
  });

  it("keeps the limitations copy neutral (no advocacy language)", () => {
    const { container } = render(<AboutPage />);
    const section = container.querySelector("#limitations");
    expect(section).not.toBeNull();
    const text = (section?.textContent ?? "").toLowerCase();
    for (const word of ["deadliest", "dangerous", "shocking", "alarming", "preventable"]) {
      expect(text).not.toContain(word);
    }
  });
});
