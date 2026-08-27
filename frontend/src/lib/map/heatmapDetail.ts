/**
 * Pick the county slugs whose detail-heatmap should be loaded.
 *
 * - In compareMode the explicit focused/compare pair drives the heatmap so the
 *   pair-compare workflow keeps its established behavior.
 * - Otherwise the URL filter wins (capped at 2 — useHeatmapSuppression covers
 *   the 3+ case by hiding the heatmap while the selection stands).
 *
 * Returns slugified county names (lowercase, spaces → hyphens). The result
 * is stable: `compareMode` with both null returns []; out-of-range selection
 * sizes return [].
 */
export function selectHeatmapDetailSlugs(args: {
  compareMode: boolean;
  focusedCounty: string | null;
  compareCounty: string | null;
  selectedCounties: ReadonlySet<string>;
}): string[] {
  const { compareMode, focusedCounty, compareCounty, selectedCounties } = args;
  if (compareMode) {
    const slugs: string[] = [];
    if (focusedCounty) slugs.push(slugify(focusedCounty));
    if (compareCounty) slugs.push(slugify(compareCounty));
    return slugs;
  }
  if (selectedCounties.size === 0 || selectedCounties.size > 2) return [];
  return [...selectedCounties].map(slugify);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}
