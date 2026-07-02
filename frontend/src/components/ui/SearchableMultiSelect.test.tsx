import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import SearchableMultiSelect from "./SearchableMultiSelect";

const OPTIONS = [
  { value: "a", label: "Alameda" },
  { value: "b", label: "Butte" },
  { value: "c", label: "Colusa" },
];

function Harness({ initial = [] as string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const toggle = (v: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  return (
    <SearchableMultiSelect options={OPTIONS} selected={selected} onToggle={toggle} placeholder="Search counties" />
  );
}

describe("SearchableMultiSelect accessibility", () => {
  it("exposes combobox + listbox semantics with aria-multiselectable", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Search counties" });
    expect(input).toHaveAttribute("aria-haspopup", "listbox");
    expect(input).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
  });

  it("each option exposes aria-selected reflecting the selected set", async () => {
    render(<Harness initial={["a"]} />);
    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByRole("option", { name: "Alameda" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Butte" })).toHaveAttribute("aria-selected", "false");
    // The decorative check icon must not leak "check" into the accessible name.
    expect(screen.getByRole("option", { name: "Alameda" })).toHaveAccessibleName("Alameda");
  });

  it("closes on Escape and returns focus to the input", async () => {
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("supports arrow navigation with aria-activedescendant and Enter toggles", async () => {
    const onToggle = vi.fn();
    render(<SearchableMultiSelect options={OPTIONS} selected={new Set()} onToggle={onToggle} />);
    const input = screen.getByRole("combobox");
    await userEvent.click(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const first = screen.getByRole("option", { name: "Alameda" });
    expect(input).toHaveAttribute("aria-activedescendant", first.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith("a");
  });
});
