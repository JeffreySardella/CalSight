import { useCallback, useRef } from "react";
import { useSearchParams, type NavigateOptions } from "react-router-dom";

/**
 * Safe writer for the URL-as-state this app leans on (filters, county, layers,
 * viewport, drill-down all live in the query string).
 *
 * React Router's `setSearchParams(prev => …)` does NOT hand the callback the
 * live URL: it hands it the search params of the render that produced *that
 * setter*. Every writer therefore merges into whatever the URL looked like when
 * its closure was created, and silently drops any param added since. Two ways
 * that bites here:
 *
 *  1. Cross-tick staleness. The viewport sync debounces `moveend` by 250ms, so
 *     it fires from a timer holding an older setter. Clicking a county calls
 *     `setCounty` and then fits the map to that county; the resulting `moveend`
 *     write lands a moment later with a pre-click base URL and wipes `county=`.
 *     The selection is undone before the heatmap can load — which is why a
 *     county often needed a *second* click to light up.
 *  2. Same-tick chaining. "Clear all" calls `clearFilters()` then
 *     `clearCounties()`; both get the same `prev`, so the second write restores
 *     the filters the first one just removed.
 *
 * Fixes for both:
 *  - route every write through a ref to the *newest* setter, so `prev` reflects
 *    the latest render no matter how old the caller's closure is;
 *  - buffer the params we just wrote for the rest of the synchronous tick, so
 *    back-to-back writes chain instead of clobbering each other.
 *
 * The buffer is module-level (not per-hook) so writers living in different
 * hooks — e.g. a filter change and a layer change in one handler — chain too.
 */

let pending: URLSearchParams | null = null;
let flushScheduled = false;

/** Exposed for tests; clears the same-tick buffer. */
export function resetSearchParamsBuffer(): void {
  pending = null;
  flushScheduled = false;
}

function rememberPending(next: URLSearchParams): void {
  pending = new URLSearchParams(next);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    pending = null;
    flushScheduled = false;
  });
}

export type SearchParamsWriter = (
  update: (prev: URLSearchParams) => URLSearchParams,
  options?: NavigateOptions,
) => void;

export function useSearchParamsWriter(): [URLSearchParams, SearchParamsWriter] {
  const [searchParams, setSearchParams] = useSearchParams();

  // Refreshed on every render so a writer invoked from a stale closure still
  // reaches the current setter (same pattern the map layers use for callbacks).
  const setterRef = useRef(setSearchParams);
  setterRef.current = setSearchParams;

  const write = useCallback<SearchParamsWriter>((update, options) => {
    setterRef.current((prev) => {
      const next = update(new URLSearchParams(pending ?? prev));
      rememberPending(next);
      return next;
    }, options);
  }, []);

  return [searchParams, write];
}
