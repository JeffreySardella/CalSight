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

// DB truth: canonical_cause has 10 values after issue #139 expanded the taxonomy.
// "distracted" and "weather" are cross-cutting filter facets, not cause buckets.
// The backend maps URL slugs (hyphens) → DB values (underscores) in filters.py.
export const CAUSES = [
  { value: "dui", label: "DUI", icon: "local_bar" },
  { value: "speeding", label: "Speeding", icon: "speed" },
  { value: "lane-change", label: "Lane Change", icon: "swap_horiz" },
  { value: "right-of-way", label: "Right of Way", icon: "priority_high" },
  { value: "turning", label: "Improper Turn", icon: "turn_right" },
  { value: "following-too-close", label: "Tailgating", icon: "car_crash" },
  { value: "signal-violation", label: "Signal Violation", icon: "traffic" },
  { value: "pedestrian-violation", label: "Ped. Violation", icon: "directions_walk" },
  { value: "unsafe-backing", label: "Unsafe Backing", icon: "keyboard_return" },
  { value: "other", label: "Other", icon: "more_horiz" },
] as const;

// Boolean involvement flags — backed by is_alcohol_involved / is_distraction_involved.
// NOTE: These columns are NULL for all SWITRS rows (pre-2016). Enabling either
// filter implicitly limits results to CCRS data (2016+). See db-schema.md.
export const INVOLVEMENTS = [
  { value: "alcohol", label: "Alcohol", icon: "local_bar" },
  { value: "distracted", label: "Distracted", icon: "phonelink_ring" },
  { value: "pedestrian", label: "Ped. Involved", icon: "directions_walk" },
  { value: "cyclist", label: "Cyclist", icon: "pedal_bike" },
  { value: "drug", label: "Drug-Involved", icon: "medication" },
] as const;

export const DRIVER_AGE_BRACKETS = [
  { value: "16-21", label: "16–21" },
  { value: "22-34", label: "22–34" },
  { value: "35-49", label: "35–49" },
  { value: "50-64", label: "50–64" },
  { value: "65+", label: "65+" },
] as const;

const CAUSE_VALUES: Set<string> = new Set(CAUSES.map((c) => c.value));

const DEFAULT_SEVERITIES = new Set<string>();

// ── Date range types ──

export type YearMonth = { year: number; month: number }; // month: 1–12

/**
 * Filter on `crash_datetime`. `start` and `end` are independent — either side
 * may be null (open-ended). The "no filter" representation is `null` for the
 * whole DateRangeFilter, not `{ start: null, end: null }`.
 */
export type DateRangeFilter = { start: YearMonth | null; end: YearMonth | null };

export function formatYearMonth(ym: YearMonth): string {
  return `${ym.year}-${String(ym.month).padStart(2, "0")}`;
}

export function parseYearMonth(raw: string | null): YearMonth | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isInteger(y) || !Number.isInteger(mo)) return null;
  if (y < START_YEAR || y > currentYear) return null;
  if (mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}

/** Compare two YearMonths; -1 / 0 / 1 like Array.prototype.sort. */
function compareYM(a: YearMonth, b: YearMonth): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

/** Read the current date-range filter from the URL. Null = no filter. */
function readDateRange(searchParams: URLSearchParams): DateRangeFilter | null {
  const start = parseYearMonth(searchParams.get("start"));
  const end = parseYearMonth(searchParams.get("end"));

  if (start || end) {
    return { start, end };
  }

  // Legacy: ?year=2020,2023 collapses to a Jan(min)–Dec(max) range so old
  // permalinks keep working. We only convert here for display; year-mode
  // mutators are no longer exposed.
  const legacyYears = parseLegacyYearList(searchParams.get("year"));
  if (legacyYears.length > 0) {
    const min = Math.min(...legacyYears);
    const max = Math.max(...legacyYears);
    return {
      start: { year: min, month: 1 },
      end: { year: max, month: 12 },
    };
  }

  return null;
}

function parseLegacyYearList(param: string | null): number[] {
  if (!param) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && YEARS.includes(n));
}

/**
 * Project a date range onto a year set — every year between start.year and
 * end.year inclusive. Used for legacy consumers (charts, MV-backed endpoints)
 * that only know about whole-year filtering.
 */
export function yearsInRange(range: DateRangeFilter | null): Set<number> {
  if (!range) return new Set<number>();
  const startY = range.start ? range.start.year : START_YEAR;
  const endY = range.end ? range.end.year : currentYear;
  if (startY > endY) return new Set<number>();
  const out = new Set<number>();
  for (let y = startY; y <= endY; y++) {
    if (y >= START_YEAR && y <= currentYear) out.add(y);
  }
  return out;
}

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

const FILTER_KEYS = [
  "start", "end", "year", "severity", "county", "cause",
  "alcohol", "distracted", "pedestrian", "cyclist", "drug", "driver_age",
] as const;

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

  // ── Memoize parsed values by their raw URL string ──
  // Without this, every render produces a brand-new Set/object which
  // cascades through useMemo deps in CountyBoundaries, ChoroplethLegend,
  // etc., causing an infinite re-render loop.
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const yearParam = searchParams.get("year");
  const severityParam = searchParams.get("severity");
  const countyParam = searchParams.get("county");
  const causeParam = searchParams.get("cause");
  const alcoholParam = searchParams.get("alcohol");
  const distractedParam = searchParams.get("distracted");
  const pedestrianParam = searchParams.get("pedestrian");
  const cyclistParam = searchParams.get("cyclist");
  const drugParam = searchParams.get("drug");
  const driverAgeParam = searchParams.get("driver_age");
  const panel = searchParams.get("panel");

  const selectedDateRange = useMemo<DateRangeFilter | null>(() => {
    // Re-derive directly from the raw URL params so this stays referentially
    // stable between renders — the parsed result only changes when the raw
    // URL strings actually change.
    const sp = new URLSearchParams();
    if (startParam != null) sp.set("start", startParam);
    if (endParam != null) sp.set("end", endParam);
    if (yearParam != null) sp.set("year", yearParam);
    return readDateRange(sp);
  }, [startParam, endParam, yearParam]);

  const selectedYears = useMemo(() => yearsInRange(selectedDateRange), [selectedDateRange]);
  const selectedSeverities = useMemo(() => parseSeverities(severityParam), [severityParam]);
  const selectedCounties = useMemo(() => parseCounties(countyParam), [countyParam]);
  const selectedCauses = useMemo(() => parseCauses(causeParam), [causeParam]);
  const selectedAlcohol = useMemo(() => parseBoolFlag(alcoholParam), [alcoholParam]);
  const selectedDistracted = useMemo(() => parseBoolFlag(distractedParam), [distractedParam]);
  const selectedPedestrian = useMemo(() => parseBoolFlag(pedestrianParam), [pedestrianParam]);
  const selectedCyclist = useMemo(() => parseBoolFlag(cyclistParam), [cyclistParam]);
  const selectedDrug = useMemo(() => parseBoolFlag(drugParam), [drugParam]);
  const selectedDriverAge = useMemo(() => driverAgeParam ?? null, [driverAgeParam]);

  // ── Action callbacks ──

  const setDateRange = useCallback(
    (start: YearMonth | null, end: YearMonth | null) => {
      // Auto-correct flipped ranges.
      if (start && end && compareYM(start, end) > 0) {
        [start, end] = [end, start];
      }
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.delete("year"); // Drop legacy param when entering date-range mode.
        if (start) params.set("start", formatYearMonth(start));
        else params.delete("start");
        if (end) params.set("end", formatYearMonth(end));
        else params.delete("end");
        return params;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const clearDateRange = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("start");
      params.delete("end");
      params.delete("year");
      return params;
    }, { replace: true });
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

  const setCounty = useCallback(
    (county: string) => {
      setSearchParams((prev) => buildNextParams(prev, { counties: new Set([county]) }), { replace: true });
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

  const togglePedestrian = useCallback(() => {
    setSearchParams((prev) => {
      const current = parseBoolFlag(prev.get("pedestrian"));
      return buildNextParams(prev, { pedestrian: !current });
    }, { replace: true });
  }, [setSearchParams]);

  const toggleCyclist = useCallback(() => {
    setSearchParams((prev) => {
      const current = parseBoolFlag(prev.get("cyclist"));
      return buildNextParams(prev, { cyclist: !current });
    }, { replace: true });
  }, [setSearchParams]);

  const toggleDrug = useCallback(() => {
    setSearchParams((prev) => {
      const current = parseBoolFlag(prev.get("drug"));
      return buildNextParams(prev, { drug: !current });
    }, { replace: true });
  }, [setSearchParams]);

  const setDriverAge = useCallback(
    (bracket: string | null) => {
      setSearchParams((prev) => buildNextParams(prev, { driverAge: bracket }), { replace: true });
    },
    [setSearchParams],
  );

  // Clears all filter dimensions — date range, severity, cause, alcohol, distracted, etc.
  // (County is intentionally preserved; use clearCounties() separately.)
  const clearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("start");
      params.delete("end");
      params.delete("year");
      params.delete("severity");
      params.delete("cause");
      params.delete("alcohol");
      params.delete("distracted");
      params.delete("pedestrian");
      params.delete("cyclist");
      params.delete("drug");
      params.delete("driver_age");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const setAllFilters = useCallback((overrides: {
    start?: { year: number; month: number } | null;
    end?: { year: number; month: number } | null;
    severities?: Set<string>;
    causes?: Set<string>;
    alcohol?: boolean;
    distracted?: boolean;
    pedestrian?: boolean;
    cyclist?: boolean;
    drug?: boolean;
    driverAge?: string | null;
  }) => {
    setSearchParams((prev) => {
      const params = buildNextParams(prev, {
        severities: overrides.severities ?? new Set(),
        causes: overrides.causes ?? new Set(),
        alcohol: overrides.alcohol ?? false,
        distracted: overrides.distracted ?? false,
        pedestrian: overrides.pedestrian ?? false,
        cyclist: overrides.cyclist ?? false,
        drug: overrides.drug ?? false,
        driverAge: overrides.driverAge ?? null,
      });
      if (overrides.start) {
        params.set("start", formatYearMonth(overrides.start));
      } else {
        params.delete("start");
      }
      if (overrides.end) {
        params.set("end", formatYearMonth(overrides.end));
      } else {
        params.delete("end");
      }
      params.delete("year");
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
    selectedDateRange,
    selectedYears,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    selectedAlcohol,
    selectedDistracted,
    selectedPedestrian,
    selectedCyclist,
    selectedDrug,
    selectedDriverAge,
    setDateRange,
    clearDateRange,
    toggleSeverity,
    toggleCounty,
    setCounty,
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
    togglePedestrian,
    toggleCyclist,
    toggleDrug,
    setDriverAge,
    clearFilters,
    setAllFilters,
    panel,
    clearPanel,
  };
}

// ── Helper: build next URLSearchParams from prev + partial overrides ──

type ParamOverrides = {
  severities?: Set<string>;
  counties?: Set<string>;
  causes?: Set<string>;
  alcohol?: boolean;
  distracted?: boolean;
  pedestrian?: boolean;
  cyclist?: boolean;
  drug?: boolean;
  driverAge?: string | null;
};

function buildNextParams(
  prev: URLSearchParams,
  overrides: ParamOverrides,
): URLSearchParams {
  const params = new URLSearchParams(prev);

  const severities = overrides.severities ?? parseSeverities(prev.get("severity"));
  const counties = overrides.counties ?? parseCounties(prev.get("county"));
  const causes = overrides.causes ?? parseCauses(prev.get("cause"));

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
  if ("pedestrian" in overrides) {
    if (overrides.pedestrian) params.set("pedestrian", "true");
    else params.delete("pedestrian");
  }
  if ("cyclist" in overrides) {
    if (overrides.cyclist) params.set("cyclist", "true");
    else params.delete("cyclist");
  }
  if ("drug" in overrides) {
    if (overrides.drug) params.set("drug", "true");
    else params.delete("drug");
  }
  if ("driverAge" in overrides) {
    if (overrides.driverAge) params.set("driver_age", overrides.driverAge);
    else params.delete("driver_age");
  }

  return params;
}
