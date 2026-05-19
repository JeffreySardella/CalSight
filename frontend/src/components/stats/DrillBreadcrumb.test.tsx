import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import DrillBreadcrumb from "./DrillBreadcrumb";

describe("DrillBreadcrumb", () => {
  it("renders nothing at the state level", () => {
    const { container } = render(
      <MemoryRouter>
        <DrillBreadcrumb
          drillState={{ level: "state", county: null }}
          onDrillUp={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the drilled county name", () => {
    render(
      <MemoryRouter>
        <DrillBreadcrumb
          drillState={{ level: "county", county: "Fresno" }}
          onDrillUp={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Fresno County")).toBeInTheDocument();
  });

  it("calls onDrillUp when California is clicked", async () => {
    const onDrillUp = vi.fn();
    render(
      <MemoryRouter>
        <DrillBreadcrumb
          drillState={{ level: "county", county: "Fresno" }}
          onDrillUp={onDrillUp}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "California" }));
    expect(onDrillUp).toHaveBeenCalledTimes(1);
  });

  it("Show on Map link targets the county and carries active filters", () => {
    render(
      <MemoryRouter initialEntries={["/stats?drill_county=fresno&severity=fatal&cause=dui"]}>
        <DrillBreadcrumb
          drillState={{ level: "county", county: "Fresno" }}
          onDrillUp={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /show fresno county on map/i });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("county")).toBe("fresno");
    // Stats-internal drill_county param is dropped, not carried to the map.
    expect(url.searchParams.get("drill_county")).toBeNull();
    // Active filters carry over.
    expect(url.searchParams.get("severity")).toBe("fatal");
    expect(url.searchParams.get("cause")).toBe("dui");
  });
});
