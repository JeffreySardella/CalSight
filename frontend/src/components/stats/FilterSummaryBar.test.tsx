import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FilterSummaryBar, { type FilterChip } from "./FilterSummaryBar";

describe("FilterSummaryBar", () => {
  it("is sticky on mobile via the sticky-filter-bar class", () => {
    render(<FilterSummaryBar chips={[]} onEditFilters={() => {}} />);
    const bar = screen.getByRole("region", { name: "Active filters" });
    expect(bar).toHaveClass("sticky-filter-bar");
  });

  it("renders removable chips with working remove buttons", () => {
    const onRemove = vi.fn();
    const chips: FilterChip[] = [{ label: "Fresno", onRemove }];
    render(<FilterSummaryBar chips={chips} onEditFilters={() => {}} />);

    expect(screen.getByText("Fresno")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Fresno filter" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders 'All X' chips that open the filter editor", () => {
    const onOpen = vi.fn();
    const chips: FilterChip[] = [{ label: "All Counties", onOpen }];
    render(<FilterSummaryBar chips={chips} onEditFilters={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /All Counties/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("styles cross-filter chips with the tertiary variant", () => {
    const chips: FilterChip[] = [
      { label: "Cross-filter: Severity", onRemove: () => {}, variant: "tertiary" },
    ];
    render(<FilterSummaryBar chips={chips} onEditFilters={() => {}} />);
    expect(screen.getByText("Cross-filter: Severity")).toHaveClass("text-tertiary");
  });

  it("fires onEditFilters from the Edit Filters button", () => {
    const onEditFilters = vi.fn();
    render(<FilterSummaryBar chips={[]} onEditFilters={onEditFilters} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit Filters/ }));
    expect(onEditFilters).toHaveBeenCalledTimes(1);
  });
});
