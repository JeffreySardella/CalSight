/**
 * Repairs a service-worker precache that stored the SPA page as a build file.
 *
 * During a deploy, Cloudflare's edge can answer a request for a brand-new
 * /assets/ file with index.html and a 200 for a few minutes (the SPA
 * catch-all). A worker that updated in that window precached the HTML under
 * the stylesheet's and chunks' URLs: on 2026-09-23 the Water page rendered
 * empty ("Expected a JavaScript module script but the server responded with a
 * MIME type of text/html"). Workbox never re-downloads a URL it already holds,
 * so the damage outlives the deploy. functions/_middleware.ts now 404s those
 * requests so a worker cannot store them again; this clears what is already
 * stored. With the entry gone, the worker falls back to the network, which
 * has the real file.
 */

const PRECACHE_PREFIX = "workbox-precache";
const RELOAD_FLAG = "calsight-precache-healed";
const STATIC_FILE = /\.(?:js|mjs|css|woff2?|png|webp|svg|geojson)$/i;

/** Deletes precached build files whose stored response is HTML; returns their URLs. */
export async function dropHtmlPrecacheEntries(cacheStorage: CacheStorage = caches): Promise<string[]> {
  const dropped: string[] = [];
  for (const name of await cacheStorage.keys()) {
    if (!name.startsWith(PRECACHE_PREFIX)) continue;
    const cache = await cacheStorage.open(name);
    for (const request of await cache.keys()) {
      if (!STATIC_FILE.test(new URL(request.url).pathname)) continue;
      const response = await cache.match(request);
      if (response?.headers.get("content-type")?.includes("text/html")) {
        await cache.delete(request);
        dropped.push(request.url);
      }
    }
  }
  return dropped;
}

/**
 * The browser's own HTTP cache can hold the same HTML: the SPA fallback went
 * out under /assets/'s one-year immutable Cache-Control. `cache: "reload"`
 * refetches from the network and overwrites that entry.
 */
export async function refreshHttpCache(urls: readonly string[]): Promise<void> {
  await Promise.all(urls.map((u) => fetch(u, { cache: "reload" }).catch(() => undefined)));
}

/** The module URL in a failed dynamic import's message, if it names one. */
export function failedModuleUrl(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = /https?:\/\/[^\s"']+?\.(?:js|mjs|css)(?![\w-])/.exec(text);
  return match ? match[0] : null;
}

/**
 * Runs the repair and, if anything was removed or refreshed, reloads once so
 * the page gets the real files. `alsoRefresh` names URLs a failed load
 * reported. The session flag stops a loop if the network itself is serving
 * HTML for a file (the worker would store nothing new either way).
 */
export async function healPrecache(
  reload: () => void = () => window.location.reload(),
  alsoRefresh: readonly string[] = [],
): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const dropped = await dropHtmlPrecacheEntries();
    const stale = [...new Set([...dropped, ...alsoRefresh])];
    if (stale.length === 0) return;
    await refreshHttpCache(stale);
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
    reload();
  } catch {
    // Cache Storage can be unavailable (private mode, blocked site data); the
    // page then loads from the network and there is nothing to repair.
  }
}
