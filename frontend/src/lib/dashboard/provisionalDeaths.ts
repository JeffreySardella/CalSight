/**
 * Provisional death counts.
 *
 * A death is recorded against its crash only once the outcome is confirmed,
 * which the county report card ("Death counts lag") puts at six months or
 * more. So the newest years' death-based figures (people killed, KSI, deaths
 * per 1,000 crashes) are still rising, and a year-over-year comparison that
 * ends on one of them shows a drop that may never have happened: in Sept 2026
 * the Stats page called 2025 vs 2024 "-14.8% improved" on exactly that.
 *
 * The rule: a year's deaths are provisional until DEATH_SETTLE_MONTHS months
 * after the year ends. 12, not 6, because "six months or more" is a floor, not
 * a ceiling: a December crash can add a death weeks later, and agencies file
 * late. With 12 the previous year stays provisional for the whole of the
 * current year, so no headline can flip to a verdict on a year that closed
 * only 6 to 9 months ago. It depends on today's date, so it ages by itself.
 * Lower the constant if the data shows years settle sooner.
 *
 * Unlike partialYear.ts (the year still in progress, all measures), this is
 * about deaths only: crash counts for a closed year are close to final.
 */

const DEATH_SETTLE_MONTHS = 12;

/** Measures built on death counts, which inherit the lag. */
const DEATH_MEASURES: ReadonlySet<string> = new Set(["killed", "ksi", "fatality_rate"]);

export function isDeathMeasure(measure: string | undefined): boolean {
  return measure != null && DEATH_MEASURES.has(measure);
}

/** True while `year`'s death counts may still rise. */
export function isProvisionalDeathYear(year: number | string, now: Date = new Date()): boolean {
  const y = typeof year === "string" ? Number.parseInt(year, 10) : year;
  if (!Number.isInteger(y)) return false;
  // Date rolls month overflow forward: (y + 1, 12) is 1 Jan of y + 2.
  return now < new Date(y + 1, DEATH_SETTLE_MONTHS, 1);
}

/** The newest year whose death counts are settled. */
export function latestSettledDeathYear(now: Date = new Date()): number {
  let y = now.getFullYear();
  while (isProvisionalDeathYear(y, now)) y--;
  return y;
}

/**
 * Footnote for a year chart of a death measure when any charted year is
 * provisional, else null. Rendered like partialYearNote.
 */
export function provisionalDeathNote(labels: Iterable<string | number>, now: Date = new Date()): string | null {
  const years = [...labels]
    .map((l) => (typeof l === "number" ? l : Number.parseInt(l, 10)))
    .filter((y) => Number.isInteger(y) && isProvisionalDeathYear(y, now))
    .sort((a, b) => a - b);
  if (years.length === 0) return null;
  const which = years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
  return `Deaths for ${which} are preliminary: a death is recorded once confirmed, which can take six months or more, so ${years.length === 1 ? "this count" : "these counts"} will rise.`;
}
