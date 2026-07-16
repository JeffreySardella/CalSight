export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Soft-launch switch for the Water page. While false, /water still renders
 * for anyone with the direct link, but nothing advertises it: no navbar or
 * tab-bar entry and no drought row on the county insight card. The backend
 * (ETL jobs, /api/water/*) runs regardless, accumulating the history the
 * "% of average" figures need.
 *
 * Launch checklist when flipping to true: restore /water in
 * public/sitemap.xml, add it back to index.html's speculationrules (and
 * recompute that script's CSP hash in public/_headers), drop the /water
 * X-Robots-Tag block in _headers, and let Ask AI's prompt point at the
 * page again (backend app/ai_prompt.py).
 */
export const WATER_PAGE_PUBLIC = false;
