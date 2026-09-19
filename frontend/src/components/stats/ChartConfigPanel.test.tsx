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

  it("sanitizes a tampered/legacy non-year initial slot carrying ksi", () => {
    const onConfirm = vi.fn();
    render(
      <ChartConfigPanel
        initial={{ dimension: "county", measure: "ksi", secondaryMeasure: "ksi", chartType: "line" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("option", { name: MEASURE_LABELS.ksi })).toBeNull();
    // The select's DOM value falls back to the first <option> when the bound
    // state doesn't match any of them, so check what Update actually emits —
    // that's what an orphaned "ksi" state would silently re-send.
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ measure: "count", secondaryMeasure: undefined }),
    );
  });
});
