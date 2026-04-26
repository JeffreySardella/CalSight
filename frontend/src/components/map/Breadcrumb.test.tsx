import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Breadcrumb from "./Breadcrumb";

describe("Breadcrumb", () => {
  it("shows default text when no county is selected", () => {
    render(<Breadcrumb inspectedCounty={null} compareCounty={null} onDeselect={vi.fn()} />);
    expect(screen.getByText("Map Explorer")).toBeInTheDocument();
  });

  it("shows county name when a county is inspected", () => {
    render(<Breadcrumb inspectedCounty="Fresno" compareCounty={null} onDeselect={vi.fn()} />);
    expect(screen.getByText("Fresno County")).toBeInTheDocument();
    expect(screen.queryByText("Map Explorer")).not.toBeInTheDocument();
  });

  it("shows compare text when two counties are selected", () => {
    render(<Breadcrumb inspectedCounty="Fresno" compareCounty="Alameda" onDeselect={vi.fn()} />);
    expect(screen.getByText(/Fresno/)).toBeInTheDocument();
    expect(screen.getByText(/Alameda/)).toBeInTheDocument();
    expect(screen.getByText(/vs/)).toBeInTheDocument();
  });

  it("calls onDeselect when State Index is clicked", async () => {
    const onDeselect = vi.fn();
    render(<Breadcrumb inspectedCounty="Fresno" compareCounty={null} onDeselect={onDeselect} />);
    await userEvent.click(screen.getByText("State Index"));
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it("State Index is not clickable when no county is selected", () => {
    render(<Breadcrumb inspectedCounty={null} compareCounty={null} onDeselect={vi.fn()} />);
    const stateIndex = screen.getByText("State Index");
    expect(stateIndex.closest("button")).toBeNull();
  });
});
