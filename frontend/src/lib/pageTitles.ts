import { buildStatsPageSeo } from "./dashboard/pageSeo";
import { getStoryById } from "./dashboard/stories";
import { PRESET_KEYS } from "./dashboard/presets";
import type { PresetKey } from "./dashboard/types";

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
 * /stats is the other kind of exception: its title DOES depend only on data
 * Layout can see (the URL), so instead of standing aside it reads ?story=/
 * ?preset= itself and reuses buildStatsPageSeo — the same function
 * StatsPage.tsx uses for its meta description — as the one source of truth.
 * (StatsPage keeps its own live activeStory/counties-driven description;
 * only the title moved here.)
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

function isPresetKey(value: string): value is PresetKey {
  return (PRESET_KEYS as readonly string[]).includes(value);
}

// Bare /stats (no ?story=/?preset=) keeps the generic dashboard title: the
// active preset there can come from a saved dashboard in localStorage, which
// the URL — and therefore Layout — has no way to see.
function statsTitleFor(search: string): string {
  const params = new URLSearchParams(search);
  const storyId = params.get("story");
  const story = storyId ? getStoryById(storyId) ?? null : null;
  const presetParam = params.get("preset");
  if (!story && !presetParam) return PAGE_TITLES["/stats"];
  const preset: PresetKey = presetParam && isPresetKey(presetParam) ? presetParam : "overview";
  return buildStatsPageSeo({ preset, story, counties: [], totalIncidents: null }).title;
}

/** The title Layout should set for `pathname`+`search`, or null when the page sets its own. */
export function pageTitleFor(pathname: string, search = ""): string | null {
  if (SELF_TITLING_ROUTES.some((re) => re.test(pathname))) return null;
  if (pathname === "/stats") return statsTitleFor(search);
  return PAGE_TITLES[pathname] || DEFAULT_PAGE_TITLE;
}
