export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Public switch for the Water page. Launched 2026-09-12: the navbar and
 * tab-bar entries, the county insight card's drought row and the map's
 * Reservoirs layer all follow it.
 *
 * Flipping it back to false soft-hides the page again — /water still
 * renders by direct link, but nothing advertises it and the reservoir map
 * layer goes dark — without touching the backend (ETL jobs and /api/water/*
 * keep running). The static launch artifacts don't follow the flag, so a
 * real rollback also means: remove /water from public/sitemap.xml and from
 * index.html's speculationrules (recompute that script's CSP hash in
 * public/_headers), restore the /water X-Robots-Tag: noindex block in
 * _headers, and re-point Ask AI's prompt (backend app/ai_prompt.py).
 */
export const WATER_PAGE_PUBLIC = true;
