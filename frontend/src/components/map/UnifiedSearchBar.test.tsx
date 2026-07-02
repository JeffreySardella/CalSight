import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UnifiedSearchBar from "./UnifiedSearchBar";

// Avoid real network / debounce from the geocoder.
vi.mock("../../hooks/useNominatim", () => ({
  useNominatim: () => ({ results: [], loading: false }),
}));

const noop = () => {};

function renderBar() {
  return render(
    <UnifiedSearchBar
      map={null}
      onSelectCounty={noop}
      onSelectPlace={noop}
      onGeolocate={noop}
    />,
  );
}

// Expand the desktop search bar and return its combobox input.
async function openDesktop() {
  renderBar();
  await userEvent.click(screen.getByRole("button", { name: "Open search" }));
  return screen.getByRole("combobox", { name: "Search counties, places, and addresses" });
}

describe("UnifiedSearchBar accessibility", () => {
  beforeEach(() => localStorage.clear());

  it("gives the input combobox semantics wired to the results listbox", async () => {
    const input = await openDesktop();
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    expect(input).toHaveAttribute("aria-expanded", "false");

    await userEvent.type(input, "alam");
    const listbox = screen.getByRole("listbox", { name: "Search results" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
  });

  it("exposes aria-activedescendant for the highlighted result on ArrowDown", async () => {
    const input = await openDesktop();
    await userEvent.type(input, "alam");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: /Alameda/ });
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", option.id);
  });

  it("renders the result row and its favorite star as siblings, not nested", async () => {
    localStorage.setItem(
      "calsight-favorites",
      JSON.stringify([{ name: "Home", lat: 37.8, lng: -122.3, county: "Alameda" }]),
    );
    await openDesktop();

    const option = screen.getByRole("option", { name: /Home/ });
    const star = screen.getByRole("button", { name: /Remove Home from favorites/ });
    // A button inside a button is invalid HTML — they must be siblings.
    expect(option.contains(star)).toBe(false);
    expect(within(option).queryByRole("button")).toBeNull();
  });

  it("labels the geolocate and zoom icon buttons", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    // "My location" appears on both mobile and desktop control clusters.
    expect(screen.getAllByRole("button", { name: "My location" }).length).toBeGreaterThan(0);
  });
});
