import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { CA_COUNTIES, slugify } from "./useFilterParams";
import { useUserPreferences } from "./useUserPreferences";

const CA_COUNTY_SET = new Set<string>(CA_COUNTIES);

/**
 * Applies the user's saved default county to the page URL in two situations:
 *
 *   1. Page mount — returns a redirect search string when no `?county=` is
 *      present and a default is configured. Callers render <Navigate> with
 *      this value before any children mount. The render-phase redirect (vs.
 *      a mount effect) sidesteps sibling effects that also write the URL on
 *      mount, e.g. MapPage's LayersStateProvider, whose last-write-wins
 *      semantics would clobber the county.
 *
 *   2. Mid-session change — when the user updates the default in Settings,
 *      the URL follows suit if it currently has either no county or a county
 *      that matches the *previous* default (i.e. an auto-applied selection).
 *      An explicit user selection — something other than the previous default
 *      or a multi-county set — wins and isn't overwritten.
 *
 * Once the URL has been populated at mount time, the render-phase redirect
 * doesn't fire again.
 */
export function useApplyDefaultCounty(): string | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const { defaultCounty } = useUserPreferences();
  const checked = useRef(false);
  const isFirstEffect = useRef(true);
  // Tracks the previous defaultCounty value so a mid-session change can
  // distinguish "auto-applied" (URL matches prior default) from "explicit".
  const prevDefault = useRef<string | null>(defaultCounty);

  useEffect(() => {
    const oldDefault = prevDefault.current;
    prevDefault.current = defaultCounty;

    // The first effect run corresponds to the initial mount — handled by the
    // render-phase redirect below, not here.
    if (isFirstEffect.current) {
      isFirstEffect.current = false;
      return;
    }

    const urlCounty = searchParams.get("county");
    const wasAutoApplied =
      !!urlCounty && !!oldDefault && urlCounty === slugify(oldDefault);

    // Leave explicit selections (anything that isn't empty or the prior default)
    // alone — that includes multi-county strings like "fresno,kern".
    if (urlCounty && !wasAutoApplied) return;

    const validNewDefault =
      defaultCounty && CA_COUNTY_SET.has(defaultCounty) ? defaultCounty : null;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (validNewDefault) next.set("county", slugify(validNewDefault));
        else next.delete("county");
        return next;
      },
      { replace: true },
    );
  }, [defaultCounty, searchParams, setSearchParams]);

  if (checked.current) return null;
  checked.current = true;

  if (searchParams.get("county")) return null;
  if (!defaultCounty || !CA_COUNTY_SET.has(defaultCounty)) return null;

  const next = new URLSearchParams(searchParams);
  next.set("county", slugify(defaultCounty));
  return `?${next.toString()}`;
}
