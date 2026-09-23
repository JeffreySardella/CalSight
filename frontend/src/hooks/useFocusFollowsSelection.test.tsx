import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusFollowsSelection } from "./useFocusFollowsSelection";

type Props = { selected: ReadonlySet<string>; focused: string | null };

function setup(initial: Props) {
  const onFocus = vi.fn();
  const view = renderHook(
    ({ selected, focused }: Props) => useFocusFollowsSelection(selected, focused, onFocus),
    { initialProps: initial },
  );
  return { onFocus, rerender: view.rerender };
}

describe("useFocusFollowsSelection", () => {
  it("moves the focus when the URL selection moves to another single county", () => {
    const sj = new Set(["San Joaquin"]);
    const { onFocus, rerender } = setup({ selected: sj, focused: "San Joaquin" });
    rerender({ selected: new Set(["Stanislaus"]), focused: "San Joaquin" });
    expect(onFocus).toHaveBeenCalledWith("Stanislaus");
  });

  it("drops the focus when the selection widens past it", () => {
    const { onFocus, rerender } = setup({ selected: new Set(["Fresno"]), focused: "Fresno" });
    rerender({ selected: new Set(["Kern", "Tulare"]), focused: "Fresno" });
    expect(onFocus).toHaveBeenCalledWith(null);
  });

  // Picking a county (search, map tap) sets the focus at once, but React
  // Router commits the URL in a transition, a render later. Reverting the
  // focus to the still-old URL county in that gap sent the camera Stanislaus ->
  // San Joaquin -> Stanislaus, and Leaflet drops a setView made mid-animation,
  // so the map could settle on the county that was just left.
  it("does not revert a new focus while the URL is still catching up", () => {
    const sj = new Set(["San Joaquin"]);
    const { onFocus, rerender } = setup({ selected: sj, focused: "San Joaquin" });
    rerender({ selected: sj, focused: "Stanislaus" });
    rerender({ selected: new Set(["Stanislaus"]), focused: "Stanislaus" });
    expect(onFocus).not.toHaveBeenCalled();
  });
});
