import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NlqQueryBar from "./NlqQueryBar";

describe("NlqQueryBar", () => {
  it("shows an ignored filter word before and after adding the chart", async () => {
    const onAddChart = vi.fn(() => "Switched to the Builder tab.");
    render(<NlqQueryBar onAddChart={onAddChart} />);
    const input = screen.getByRole("combobox", { name: "Natural language chart query" });

    await userEvent.type(input, "pedestrian deaths by year");
    expect(screen.getByText("Ignored: pedestrian")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();

    await userEvent.type(input, "{Enter}");
    expect(onAddChart).toHaveBeenCalledWith(expect.objectContaining({ dimension: "year", measure: "killed" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Added “Fatalities by Year”. Ignored “pedestrian”: use Filters to narrow the charts. Switched to the Builder tab.",
    );
  });

  it("confirms a plain add without extra notes", async () => {
    render(<NlqQueryBar onAddChart={() => undefined} />);
    await userEvent.type(screen.getByRole("combobox"), "crashes by hour{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent(/^Added “Crashes by Hour of Day”\.$/);
  });
});
