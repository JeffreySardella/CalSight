import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// ── Constants ──

const START_YEAR = 2001;
const currentYear = new Date().getFullYear();

// Builds [2001, 2002, ... , currentYear] — grows automatically each Jan 1
export const YEARS: number[] = Array.from(
  { length: currentYear - START_YEAR + 1 },
  (_, i) => START_YEAR + i,
);

// DB truth: crashes.severity has exactly 3 values.
// "Severe Injury" / "Minor Injury" were stale FE-only values that caused
// 422s from the backend. Collapsed to "Injury" per db-schema.md.
// Re-split into 4 buckets when issue #102 lands (crash_victims.injury_severity).
export const SEVERITIES = [
  "Fatal",
  "Injury",
  "Property Damage Only",
] as const;

// TODO: fetch from backend API (see backend/app/seed_counties.py)
export const CA_COUNTIES = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa",
  "Contra Costa", "Del Norte", "El Dorado", "Fresno", "Glenn",
  "Humboldt", "Imperial", "Inyo", "Kern", "Kings", "Lake", "Lassen",
  "Los Angeles", "Madera", "Marin", "Mariposa", "Mendocino", "Merced",
  "Modoc", "Mono", "Monterey", "Napa", "Nevada", "Orange", "Placer",
  "Plumas", "Riverside", "Sacramento", "San Benito", "San Bernardino",
  "San Diego", "San Francisco", "San Joaquin", "San Luis Obispo",
  "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta",
  "Sierra", "Siskiyou", "Solano", "Sonoma", "Stanislaus", "Sutter",
  "Tehama", "Trinity", "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba",
] as const;

// DB truth: canonical_cause has exactly 4 values (dui | speeding | lane_change | other).
// "distracted" and "weather" were removed — they don't exist in the DB and
// caused 422s. The backend maps URL slug "lane-change" → DB "lane_change"
// (filters.py line 91). Restore distracted/weather when issue #103 expands the taxonomy.
export const CAUSES = [
  { value: "dui", label: "DUI", icon: "local_bar" },
  { value: "speeding", label: "Speeding", icon: "speed" },
  { value: "lane-change", label: "Lane Change", icon: "swap_horiz" },
  { value: "other", label: "Other", icon: "more_horiz" },
] as const;

// Boolean involvement flags — backed by is_alcohol_involved / is_distraction_involved.
// NOTE: These columns are NULL for all SWITRS rows (pre-2016). Enabling either
// filter implicitly limits results to CCRS data (2016+). See db-schema.md.
export const INVOLVEMENTS = [
  { value: "alcohol", label: "Alcohol Involved", icon: "local_bar" },
  { value: "distracted", label: "Distracted Driving", icon: "phonelink_ring" },
] as const;

const CAUSE_VALUES: Set<string> = new Set(CAUSES.map((c) => c.value));

const DEFAULT_YEARS = new Set<number>();
const DEFAULT_SEVERITIES = new Set<string>();

// ── Slug utilities ──

export function slugify(value: string): string {
  return value.toLowerCase().replace(/ /g, "-");
}

export function deslugify(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Lookup tables for URL parsing
const SEVERITY_SLUG_MAP: Map<string, string> = new Map(
  SEVERITIES.map((s) => [slugify(s), s]),
);

const COUNTY_SLUG_MAP: Map<string, string> = new Map(
  CA_COUNTIES.map((c) => [slugify(c), c]),
);

// ── Shared parsers (exported so StatsPage can use them too) ──

export function parseYears(param: string | null): Set<number> {
  // null = param missing from URL entirely → first visit, use defaults
  // ""   = param present but empty → user cleared everything, allow empty
  if (param === null) return new Set(DEFAULT_YEARS);
  if (param === "") return new Set<number>();

  const parsed = param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n) && YEARS.includes(n));

  return new Set(parsed);
}

export function parseSeverities(param: string | null): Set<string> {
  if (param === null) return new Set(DEFAULT_SEVERITIES);
  if (param === "") return new Set<string>();

  const parsed = param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((slug) => SEVERITY_SLUG_MAP.get(slug))
    .filter((v): v is string => v !== undefined);

  return new Set(parsed);
}

export function parseCounties(param: string | null): Set<string> {
  if (!param) return new Set<string>();
  const parsed = param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((slug) => COUNTY_SLUG_MAP.get(slug))
    .filter((v): v is string => v !== undefined);
  return new Set(parsed);
}

export function parseCauses(param: string | null): Set<string> {
  if (!param) return new Set<string>();
  const parsed = param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((v) => CAUSE_VALUES.has(v));
  return new Set(parsed);
}

export function parseBoolFlag(param: string | null): boolean {
  return param === "true";
}

// ── Shared utilities ──

const FILTER_KEYS = ["year", "severity", "county", "cause", "alcohol", "distracted"] as const;

export function buildFilterQS(searchParams: URLSearchParams): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const val = searchParams.get(key);
    if (val != null) params.set(key, val);
  }
  return params.toString();
}

// ── The hook ──
// MapPage calls this. It reads the URL, returns clean state,
// and provides functions that update both state AND the URL at once.

export function useFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Memoize parsed Sets by their raw URL string ──────────────────────
  // Without this, every render produces a brand-new Set object which
  // cascades through useMemo/useCallback deps in CountyBoundaries,
  // ChoroplethLegendContainer, etc., causing an infinite re-render loop.
  const yearParam = searchParams.get("year");
  const severityParam = searchParams.get("severity");
  const countyParam = searchParams.get("county");
  const causeParam = searchParams.get("cause");
  const alcoholParam = searchParams.get("alcohol");
  const distractedParam = searchParams.get("distracted");
  const panel = searchParams.get("panel");

  // ── Memoized parsed Sets ──
  // Only recompute when the raw URL string actually changes,
  // preventing new Set references on every render.
  const selectedYears = useMemo(() => parseYears(yearParam), [yearParam]);
  const selectedSeverities = useMemo(() => parseSeverities(severityParam), [severityParam]);
  const selectedCounties = useMemo(() => parseCounties(countyParam), [countyParam]);
  const selectedCauses = useMemo(() => parseCauses(causeParam), [causeParam]);
  const selectedAlcohol = useMemo(() => parseBoolFlag(alcoholParam), [alcoholParam]);
  const selectedDistracted = useMemo(() => parseBoolFlag(distractedParam), [distractedParam]);

  // ── Action callbacks ──
  // Each reads the *latest* URL state via the functional updater
  // inside setSearchParams, avoiding stale-closure bugs.

  const toggleYear = useCallback(
    (year: number) => {
      setSearchParams((prev) => {
        const current = parseYears(prev.get("year"));
        if (current.has(year)) current.delete(year);
        else current.add(year);
        return buildNextParams(prev, { years: current });
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setYearRange = useCallback(
    (from: number, to: number) => {
      setSearchParams((prev) => {
        const current = parseYears(prev.get("year"));
        for (let y = from; y <= to; y++) {
          if (YEARS.includes(y)) current.add(y);
        }
        return buildNextParams(prev, { years: current });
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setYears = useCallback(
    (years: Set<number>) => {
      setSearchParams((prev) => buildNextParams(prev, { years }), { replace: true });
    },
    [setSearchParams],
  );

  const clearYears = useCallback(() => {
    setSearchParams((prev) => buildNextParams(prev, { years: new Set() }), { replace: true });
  }, [setSearchParams]);

  const setAllYears = useCallback(() => {
    setSearchParams((prev) => buildNextParams(prev, { years: new Set(YEARS) }), { replace: true });
  }, [setSearchParams]);

  const toggleSeverity = useCallback(
    (severity: string) => {
      setSearchParams((prev) => {
        const current = parseSeverities(prev.get("severity"));
        if (current.has(severity)) current.delete(severity);
        else current.add(severity);
        return buildNextParams(prev, { severities: current });
      }, { replace: true });
    },
    [setSearchParams],
  );

  const toggleCounty = useCallback(
    (county: string) => {
      setSearchParams((prev) => {
        const current = parseCounties(prev.get("county"));
        if (current.has(county)) current.delete(county);
        else current.add(county);
        return buildNextParams(prev, { counties: current });
      }, { replace: true });
    },
    [setSearchParams],
  );

  const clearCounties = useCallback(() => {
    setSearchParams((prev) => buildNextParams(prev, { counties: new Set() }), { replace: true });
  }, [setSearchParams]);

  const toggleCause = useCallback(
    (cause: string) => {
      setSearchParams((prev) => {
        const current = parseCauses(prev.get("cause"));
        if (current.has(cause)) current.delete(cause);
        else current.add(cause);
        return buildNextParams(prev, { causes: current });
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setCauses = useCallback(
    (causes: Set<string>) => {
      setSearchParams((prev) => buildNextParams(prev, { causes }), { replace: true });
    },
    [setSearchParams],
  );

  const setAllCauses = useCallback(() => {
    const all = new Set(CAUSES.map((c) => c.value));
    setSearchParams((prev) => buildNextParams(prev, { causes: all }), { replace: true });
  }, [setSearchParams]);

  const clearCauses = useCallback(() => {
    setSearchParams((prev) => buildNextParams(prev, { causes: new Set() }), { replace: true });
  }, [setSearchParams]);

  const setSeverities = useCallback(
    (severities: Set<string>) => {
      setSearchParams((prev) => buildNextParams(prev, { severities }), { replace: true });
    },
    [setSearchParams],
  );

  const setAllSeverities = useCallback(() => {
    const all = new Set<string>(SEVERITIES);
    setSearchParams((prev) => buildNextParams(prev, { severities: all }), { replace: true });
  }, [setSearchParams]);

  const clearSeverities = useCallback(() => {
    setSearchParams((prev) => buildNextParams(prev, { severities: new Set() }), { replace: true });
  }, [setSearchParams]);

  const toggleAlcohol = useCallback(() => {
    setSearchParams((prev) => {
      const current = parseBoolFlag(prev.get("alcohol"));
      return buildNextParams(prev, { alcohol: !current });
    }, { replace: true });
  }, [setSearchParams]);

  const toggleDistracted = useCallback(() => {
    setSearchParams((prev) => {
      const current = parseBoolFlag(prev.get("distracted"));
      return buildNextParams(prev, { distracted: !current });
    }, { replace: true });
  }, [setSearchParams]);

  // Clears all filter dimensions — year, severity, cause, alcohol, distracted.
  // (County is intentionally preserved; use clearCounties() separately.)
  const clearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("year");
      params.delete("severity");
      params.delete("cause");
      params.delete("alcohol");
      params.delete("distracted");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const clearPanel = useCallback(() => {
    setSearchParams((prev) => {
      prev.delete("panel");
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    selectedYears,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    selectedAlcohol,
    selectedDistracted,
    toggleYear,
    setYearRange,
    setYears,
    clearYears,
    setAllYears,
    toggleSeverity,
    toggleCounty,
    clearCounties,
    toggleCause,
    setCauses,
    setAllCauses,
    clearCauses,
    setSeverities,
    setAllSeverities,
    clearSeverities,
    toggleAlcohol,
    toggleDistracted,
    clearFilters,
    panel,
    clearPanel,
  };
}

// ── Helper: build next URLSearchParams from prev + partial overrides ──
// Used by the functional setSearchParams updaters above so each action
// reads the *latest* URL state, avoiding stale-closure bugs.

type ParamOverrides = {
  years?: Set<number>;
  severities?: Set<string>;
  counties?: Set<string>;
  causes?: Set<string>;
  alcohol?: boolean;
  distracted?: boolean;
};

function buildNextParams(
  prev: URLSearchParams,
  overrides: ParamOverrides,
): URLSearchParams {
  const params = new URLSearchParams(prev);

  const years = overrides.years ?? parseYears(prev.get("year"));
  const severities = overrides.severities ?? parseSeverities(prev.get("severity"));
  const counties = overrides.counties ?? parseCounties(prev.get("county"));
  const causes = overrides.causes ?? parseCauses(prev.get("cause"));

  if (years.size > 0) {
    params.set("year", [...years].sort().join(","));
  } else {
    params.delete("year");
  }
  if (severities.size > 0) {
    params.set("severity", [...severities].map(slugify).sort().join(","));
  } else {
    params.delete("severity");
  }
  if (counties.size > 0) {
    params.set("county", [...counties].map(slugify).sort().join(","));
  } else {
    params.delete("county");
  }
  if (causes.size > 0) {
    params.set("cause", [...causes].sort().join(","));
  } else {
    params.delete("cause");
  }

  // Boolean flags: only set when true; remove param entirely when false/unset
  if ("alcohol" in overrides) {
    if (overrides.alcohol) params.set("alcohol", "true");
    else params.delete("alcohol");
  }
  if ("distracted" in overrides) {
    if (overrides.distracted) params.set("distracted", "true");
    else params.delete("distracted");
  }

  return params;
}
