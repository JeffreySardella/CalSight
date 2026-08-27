import { useCallback, useRef } from "react";
import { useNavigate, useSearchParams, type NavigateOptions } from "react-router-dom";

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
 *  - read the base params from a ref refreshed every render, so they reflect
 *    the latest render no matter how old the caller's closure is;
 *  - buffer the params we just wrote for the rest of the synchronous tick, so
 *    back-to-back writes chain instead of clobbering each other.
 *
 * Writes go through `navigate` rather than `setSearchParams` so the query
 * string is formatted here — see {@link formatSearch}.
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

/**
 * Render a query string for the address bar.
 *
 * `URLSearchParams.toString()` percent-encodes commas, and every multi-select
 * filter here is comma-joined — so picking two counties turned a shareable link
 * into `?county=los-angeles%2Corange&cause=dui%2Cspeeding`. Commas are legal
 * unencoded in a query (RFC 3986 sub-delims) and both `,` and `%2C` read back
 * identically, so put them back for something a person can read. An empty set
 * yields "" rather than a dangling "?".
 */
export function formatSearch(params: URLSearchParams): string {
  const query = params.toString().replace(/%2C/g, ",");
  return query ? `?${query}` : "";
}

export function useSearchParamsWriter(): [URLSearchParams, SearchParamsWriter] {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Both refreshed every render so a writer invoked from a stale closure still
  // merges into current params (same pattern the map layers use for callbacks).
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const write = useCallback<SearchParamsWriter>((update, options) => {
    const next = update(new URLSearchParams(pending ?? paramsRef.current));
    rememberPending(next);
    navigateRef.current({ search: formatSearch(next) }, options);
  }, []);

  return [searchParams, write];
}
