import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NlqQueryBar from "./NlqQueryBar";

describe("NlqQueryBar", () => {
  it("applies a filter word via onApplyFilters instead of ignoring it", async () => {
    const onAddChart = vi.fn(() => "Switched to the Builder tab.");
    const onApplyFilters = vi.fn();
    render(<NlqQueryBar onAddChart={onAddChart} onApplyFilters={onApplyFilters} />);
    const input = screen.getByRole("combobox", { name: "Natural language chart query" });

    await userEvent.type(input, "pedestrian deaths by year");
    expect(screen.getByText("Filter: pedestrian")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();

    await userEvent.type(input, "{Enter}");
    expect(onAddChart).toHaveBeenCalledWith(expect.objectContaining({ dimension: "year", measure: "killed" }));
    expect(onApplyFilters).toHaveBeenCalledWith([{ type: "bool", key: "pedestrian" }]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added “Fatalities by Year”. Filtered to pedestrian. Switched to the Builder tab.",
    );
  });

  it("still shows an ignored word with no matching filter or dimension", async () => {
    const onAddChart = vi.fn(() => undefined);
    const onApplyFilters = vi.fn();
    render(<NlqQueryBar onAddChart={onAddChart} onApplyFilters={onApplyFilters} />);
    const input = screen.getByRole("combobox", { name: "Natural language chart query" });

    await userEvent.type(input, "motorcycle crashes by county{Enter}");
    expect(onApplyFilters).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added “Crashes by County”. Ignored “motorcycle”: use Filters to narrow the charts.",
    );
  });

  it("confirms a plain add without extra notes", async () => {
    render(<NlqQueryBar onAddChart={() => undefined} />);
    await userEvent.type(screen.getByRole("combobox"), "crashes by hour{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent(/^Added “Crashes by Hour of Day”\.$/);
  });
});
