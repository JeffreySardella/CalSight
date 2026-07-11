/**
 * Current-year annotations (#293).
 *
 * The current calendar year is necessarily incomplete in the crash database
 * (the year is still in progress), so year breakdowns that include it can
 * read as a dramatic "drop" when it's really just missing months.
 *
 * DataFreshnessBanner answers "how fresh is the database?"; this helper
 * answers the different, per-chart question "is the last year bucket a
 * partial year?" — shared by the Stats year charts and the map timelapse so
 * the wording can't drift.
 */

/** True when `year` is the in-progress calendar year. */
export function isPartialYear(year: number | string): boolean {
  const y = typeof year === "string" ? Number.parseInt(year, 10) : year;
  return Number.isInteger(y) && y === new Date().getFullYear();
}

/**
 * Returns the shared annotation string when any of `labels` is the current
 * (partial) year, or null when the note isn't needed.
 */
export function partialYearNote(labels: Iterable<string | number>): string | null {
  for (const label of labels) {
    if (isPartialYear(label)) {
      return `${new Date().getFullYear()} is partial-year data`;
    }
  }
  return null;
}
