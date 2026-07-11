/**
 * Compare-mode selection guard (#256): picking the focused county again as
 * the comparison side would compare a county with itself, which renders a
 * meaningless all-zero-diff panel. MapPage uses this to reject the pick (and
 * explain why via toast) instead of silently exiting compare mode.
 */
export function isSelfCompare(
  compareMode: boolean,
  name: string,
  focusedCounty: string | null,
): boolean {
  return compareMode && focusedCounty !== null && name === focusedCounty;
}
