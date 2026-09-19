/**
 * Which document title belongs to which route.
 *
 * Layout is the parent route element, so its title effect runs AFTER the
 * page's — React flushes child effects first — and any title a page sets
 * inline is immediately overwritten. Most pages are fine with that: their
 * title is a constant and Layout knows it. A route whose title depends on data
 * only the page has (the county report card needs the county name, or the
 * not-found wording when the slug matches no county) can't be listed here, so
 * Layout stands aside for it instead: add a pattern to SELF_TITLING_ROUTES and
 * let the page set the title through <MetaTags>.
 *
 * Lives outside Layout.tsx so that file stays a component module — mixing
 * component and non-component exports breaks Fast Refresh.
 */

const SELF_TITLING_ROUTES = [/^\/county\/[^/]+\/report\/?$/];

const PAGE_TITLES: Record<string, string> = {
  "/": "Map Explorer — CalSight",
  "/stats": "Statistics Dashboard — CalSight",
  "/ask": "Ask AI — CalSight",
  "/about": "About — CalSight",
  "/water": "Water — CalSight",
  "/privacy": "Privacy Policy — CalSight",
  "/terms": "Terms of Service — CalSight",
  "/admin/etl": "ETL Admin — CalSight",
};

export const DEFAULT_PAGE_TITLE = "CalSight — California Crash Data Explorer";

/** The title Layout should set for `pathname`, or null when the page sets its own. */
export function pageTitleFor(pathname: string): string | null {
  if (SELF_TITLING_ROUTES.some((re) => re.test(pathname))) return null;
  return PAGE_TITLES[pathname] || DEFAULT_PAGE_TITLE;
}
