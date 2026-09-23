import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FiltersPanel from "./FiltersPanel";
import type { DateRangeFilter } from "../../hooks/useFilterParams";

function renderPanel(selectedDateRange: DateRangeFilter | null, onSetDateRange = vi.fn()) {
  const noop = vi.fn();
  render(
    <FiltersPanel
      selectedDateRange={selectedDateRange}
      selectedSeverities={new Set()}
      selectedCounties={new Set()}
      selectedCauses={new Set()}
      selectedAlcohol={false}
      selectedDistracted={false}
      selectedPedestrian={false}
      selectedCyclist={false}
      selectedDrug={false}
      selectedDriverAge={null}
      onSetDateRange={onSetDateRange}
      onClearDateRange={noop}
      onToggleSeverity={noop}
      onToggleCounty={noop}
      onClearCounties={noop}
      onToggleCause={noop}
      onToggleAlcohol={noop}
      onToggleDistracted={noop}
      onTogglePedestrian={noop}
      onToggleCyclist={noop}
      onToggleDrug={noop}
      onSetDriverAge={noop}
    />,
  );
  return onSetDateRange;
}

describe("FiltersPanel date range", () => {
  it("picking only years spans January of From to December of To", async () => {
    const setFrom = renderPanel(null);
    await userEvent.click(screen.getByRole("button", { name: "From year" }));
    await userEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(setFrom).toHaveBeenCalledWith({ year: 2025, month: 1 }, null);

    const start = { year: 2025, month: 1 };
    const setTo = renderPanel({ start, end: null });
    await userEvent.click(screen.getAllByRole("button", { name: "To year" })[1]);
    await userEvent.click(screen.getByRole("button", { name: "2025" }));
    expect(setTo).toHaveBeenCalledWith(start, { year: 2025, month: 12 });
  });

  it("labels a whole-year range as years", () => {
    renderPanel({ start: { year: 2025, month: 1 }, end: { year: 2025, month: 12 } });
    expect(screen.getByText("2025", { selector: "p" })).toBeInTheDocument();
  });
});
