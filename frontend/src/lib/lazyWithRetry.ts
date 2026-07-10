import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Retry a dynamic `import()` a few times before giving up.
 *
 * After a deploy the previous build's chunk hashes 404, so a user with the old
 * `index.html` open hits "Failed to fetch dynamically imported module" the first
 * time they navigate to a not-yet-loaded route. A single retry usually resolves
 * it (the CDN serves the new chunk); if every attempt fails we rethrow so the
 * surrounding ErrorBoundary shows its retry/reload UI instead of hanging on the
 * Suspense spinner forever.
 */
export async function retryDynamicImport<T>(
  factory: () => Promise<T>,
  retries = 2,
  delayMs = 300,
): Promise<T> {
  try {
    return await factory();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return retryDynamicImport(factory, retries - 1, delayMs);
  }
}

// Chrome/Firefox say "Failed to fetch dynamically imported module"; Safari says
// "Importing a module script failed". Both mean the chunk URL itself is broken —
// after a deploy, permanently so (old hashed chunks are gone from the CDN).
const CHUNK_LOAD_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed/;

export function isChunkLoadError(err: unknown): boolean {
  return err instanceof Error && CHUNK_LOAD_ERROR_RE.test(err.message);
}

// One-shot guard: if the reload itself still can't load the chunk (e.g. the
// route is genuinely broken, not just stale), don't loop reloading forever —
// fall through to the ErrorBoundary instead. sessionStorage survives the
// reload but not a new tab, which is exactly the scope we want.
export const CHUNK_RELOAD_FLAG = "calsight-chunk-reload";

/**
 * Import a route chunk with transient retries, and — when the chunk is
 * permanently gone (post-deploy 404) — reload the page once so the browser
 * picks up the new `index.html` with the new chunk URLs. Without the reload,
 * React caches the lazy rejection, so the ErrorBoundary's "Try again" can
 * never succeed for this failure class (audit L14).
 */
export async function importWithChunkReload<T>(
  factory: () => Promise<T>,
  retries = 2,
  delayMs = 300,
): Promise<T> {
  try {
    const mod = await retryDynamicImport(factory, retries, delayMs);
    // Chunk loaded fine — re-arm the guard for the next deploy.
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
    return mod;
  } catch (err) {
    if (isChunkLoadError(err) && !sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
      window.location.reload();
      // The page is going away; never settle so the Suspense fallback stays up
      // instead of flashing the error UI during the reload.
      return new Promise<never>(() => {});
    }
    throw err;
  }
}

/** `React.lazy` with transient chunk-load retries. Drop-in for `lazy()`. */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithChunkReload(factory));
}
