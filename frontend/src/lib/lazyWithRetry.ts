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

/** `React.lazy` with transient chunk-load retries. Drop-in for `lazy()`. */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => retryDynamicImport(factory));
}
