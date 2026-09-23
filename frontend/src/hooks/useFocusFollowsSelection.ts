import { useEffect } from "react";

/**
 * Keep focusedCounty in sync when the URL filter moves to a different single
 * county (e.g. user changed their default-county preference and the hook
 * rewrote the URL). Without this, CountyBoundaries still draws the prior focus
 * as colored on top of the new filter selection.
 */
export function useFocusFollowsSelection(
  selectedCounties: ReadonlySet<string>,
  focusedCounty: string | null,
  onFocus: (name: string | null) => void,
): void {
  useEffect(() => {
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
