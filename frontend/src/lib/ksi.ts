/**
 * KSI (killed or seriously injured) wording. One string, used by the year
 * chart footnote (ChartCard) and the Stats hero tile tooltip (JargonTerm's
 * KSI entry), and copied verbatim into docs/DATA_METHODOLOGY.md §5.6.
 * Change all three together.
 */
export const KSI_DEFINITION = `KSI = people killed or seriously injured. Before 2016 "seriously injured" is SWITRS's "severe injury". From 2016 it is CCRS's "suspected serious injury" plus the older "severe" code that agencies phased out through about 2025. The definitions are close but not identical, so compare years across 2015→2016 (and 2017→2018, when most agencies switched) with care.`;

/** Where the definition shifts: SWITRS→CCRS, then most agencies' KABCO switch. */
const BOUNDARIES: ReadonlyArray<readonly [number, number]> = [[2015, 2016], [2017, 2018]];

/** The asterisk footnote when the charted years span a definition change, else null. */
export function ksiDefinitionNote(labels: Iterable<string | number>): string | null {
  const years = [...labels]
    .map((l) => (typeof l === "number" ? l : Number.parseInt(l, 10)))
    .filter(Number.isInteger);
  if (years.length === 0) return null;
  const first = Math.min(...years);
  const last = Math.max(...years);
  return BOUNDARIES.some(([before, after]) => first <= before && last >= after)
    ? `* ${KSI_DEFINITION}`
    : null;
}
