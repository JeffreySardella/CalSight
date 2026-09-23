import { useEffect, useRef } from "react";

/**
 * Keep focusedCounty in sync when the URL filter moves to a different single
 * county (e.g. user changed their default-county preference and the hook
 * rewrote the URL). Without this, CountyBoundaries still draws the prior focus
 * as colored on top of the new filter selection.
 *
 * Only a change of the *selection* moves the focus. Picking a county (search,
 * map tap) sets the focus at once, but React Router commits the URL inside a
 * transition, a render later. Reacting to the focus change as well reverted it
 * to the old URL county in that gap, then forward again when the URL landed:
 * three fitBounds (new, old, new) for one pick. Leaflet ignores a setView made
 * while a zoom animation runs, so the camera could settle on the county just
 * left, with the new one's heat and outline drawn around it.
 */
export function useFocusFollowsSelection(
  selectedCounties: ReadonlySet<string>,
  focusedCounty: string | null,
  onFocus: (name: string | null) => void,
): void {
  const seenRef = useRef(selectedCounties);
  useEffect(() => {
    if (seenRef.current === selectedCounties) return;
    seenRef.current = selectedCounties;
    if (!focusedCounty) return;
    if (selectedCounties.size === 0) return;
    if (selectedCounties.has(focusedCounty)) return;
    if (selectedCounties.size === 1) {
      const [name] = [...selectedCounties];
      onFocus(name);
    } else {
      onFocus(null);
    }
  }, [selectedCounties, focusedCounty, onFocus]);
}
