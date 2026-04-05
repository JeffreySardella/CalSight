import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SearchPill from "./SearchPill";
import type { Map as LeafletMap } from "leaflet";

function createMockMap() {
  return {
    setView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  } as unknown as LeafletMap;
}

describe("SearchPill", () => {
  it("renders the search button", () => {
    render(<SearchPill map={null} />);
    expect(screen.getByText("Search California")).toBeInTheDocument();
  });

  it("calls map.setView when location button is clicked", async () => {
    const map = createMockMap();
    render(<SearchPill map={map} />);
    const locationBtn = screen.getByText("my_location").closest("button")!;
    await userEvent.click(locationBtn);
    expect(map.setView).toHaveBeenCalledWith(
      [37.2, -119.5],
      6,
      { animate: true, duration: 0.5 }
    );
  });

  it("calls map.zoomIn when zoom in button is clicked", async () => {
    const map = createMockMap();
    render(<SearchPill map={map} />);
    const zoomInBtn = screen.getByText("zoom_in").closest("button")!;
    await userEvent.click(zoomInBtn);
    expect(map.zoomIn).toHaveBeenCalledWith(1, { animate: true });
  });

  it("calls map.zoomOut when zoom out button is clicked", async () => {
    const map = createMockMap();
    render(<SearchPill map={map} />);
    const zoomOutBtn = screen.getByText("zoom_out").closest("button")!;
    await userEvent.click(zoomOutBtn);
    expect(map.zoomOut).toHaveBeenCalledWith(1, { animate: true });
  });

  it("does not throw when map is null and buttons are clicked", async () => {
    render(<SearchPill map={null} />);
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      await userEvent.click(btn);
    }
  });
});
