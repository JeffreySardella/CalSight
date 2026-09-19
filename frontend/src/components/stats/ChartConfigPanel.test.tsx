import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ChartConfigPanel from "./ChartConfigPanel";
import { MEASURE_LABELS } from "../../lib/dashboard/types";

describe("ChartConfigPanel person-level measure filtering", () => {
  it("hides fatality_rate and yoy_change for a person-level dimension (gender)", () => {
    render(
      <ChartConfigPanel
        initial={{ dimension: "gender", measure: "count", chartType: "bar" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // "bar" doesn't support dual axis, so the Measure select is the only one.
    const measureSelect = screen.getByLabelText("Measure (Y Axis)");
    expect(within(measureSelect).queryByRole("option", { name: MEASURE_LABELS.fatality_rate })).toBeNull();
    expect(within(measureSelect).queryByRole("option", { name: MEASURE_LABELS.yoy_change })).toBeNull();
    // count/killed/injured/percentage stay available.
    expect(within(measureSelect).getByRole("option", { name: MEASURE_LABELS.injured })).toBeInTheDocument();
  });

  it("still offers fatality_rate and yoy_change for a crash-level dimension (year)", () => {
    render(
      <ChartConfigPanel
        initial={{ dimension: "year", measure: "count", chartType: "bar" }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const measureSelect = screen.getByLabelText("Measure (Y Axis)");
    expect(within(measureSelect).getByRole("option", { name: MEASURE_LABELS.fatality_rate })).toBeInTheDocument();
    expect(within(measureSelect).getByRole("option", { name: MEASURE_LABELS.yoy_change })).toBeInTheDocument();
  });

  it("sanitizes a tampered/legacy person-level initial slot carrying fatality_rate to count", () => {
    const onConfirm = vi.fn();
    render(
      <ChartConfigPanel
        initial={{ dimension: "age_bracket", measure: "fatality_rate", secondaryMeasure: "yoy_change", chartType: "bar" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("option", { name: MEASURE_LABELS.fatality_rate })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ measure: "count", secondaryMeasure: undefined }),
    );
  });

  it("drops an unavailable measure when switching from year to a person-level dimension", () => {
    const onConfirm = vi.fn();
    render(
      <ChartConfigPanel
        initial={{ dimension: "year", measure: "yoy_change", chartType: "line" }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Dimension (X Axis)"), { target: { value: "at_fault_gender" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ measure: "count" }));
  });
});
