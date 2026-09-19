import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChartConfigPanel from "./ChartConfigPanel";
import { MEASURE_LABELS } from "../../lib/dashboard/types";

function renderPanel() {
  render(<ChartConfigPanel onConfirm={vi.fn()} onCancel={vi.fn()} />);
  return screen.getByLabelText("Dimension (X Axis)");
}

describe("ChartConfigPanel KSI option", () => {
  it("offers KSI on the year axis", () => {
    fireEvent.change(renderPanel(), { target: { value: "year" } });
    expect(screen.getAllByRole("option", { name: MEASURE_LABELS.ksi }).length).toBeGreaterThan(0);
  });

  it("does not offer KSI elsewhere and drops it when leaving year", () => {
    const dim = renderPanel();
    fireEvent.change(dim, { target: { value: "year" } });
    fireEvent.change(screen.getByLabelText("Measure (Y Axis)"), { target: { value: "ksi" } });
    fireEvent.change(dim, { target: { value: "county" } });
    expect(screen.queryByRole("option", { name: MEASURE_LABELS.ksi })).toBeNull();
    expect((screen.getByLabelText("Measure (Y Axis)") as HTMLSelectElement).value).toBe("count");
  });
});
