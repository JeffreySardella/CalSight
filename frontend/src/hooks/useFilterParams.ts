import { useSearchParams } from "react-router-dom";

// ── Constants ──

const START_YEAR = 2001;
const currentYear = new Date().getFullYear();

// Builds [2001, 2002, ... , currentYear] — grows automatically each Jan 1
export const YEARS: number[] = Array.from(
  { length: currentYear - START_YEAR + 1 },
  (_, i) => START_YEAR + i,
);

const SEVERITIES = [
  "Fatal",
  "Severe Injury",
  "Minor Injury",
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

export const CAUSES = [
  { value: "dui", label: "DUI", icon: "local_bar" },
  { value: "speeding", label: "Speeding", icon: "speed" },
  { value: "distracted", label: "Distracted", icon: "phonelink_ring" },
  { value: "weather", label: "Weather", icon: "thunderstorm" },
  { value: "lane-change", label: "Lane Change", icon: "swap_horiz" },
  { value: "other", label: "Other", icon: "more_horiz" },
] as const;

const CAUSE_VALUES = new Set(CAUSES.map((c) => c.value));

const DEFAULT_YEARS = new Set([2020, 2023]);
const DEFAULT_SEVERITIES = new Set<string>(["Fatal"]);

// ── Slug utilities ──
// URLs look nicer with "severe-injury" than "Severe%20Injury"

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

// ── The hook ──
// MapPage calls this. It reads the URL, returns clean state,
// and provides functions that update both state AND the URL at once.

export function useFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedYears = parseYears(searchParams.get("year"));
  const selectedSeverities = parseSeverities(searchParams.get("severity"));
  const selectedCounties = parseCounties(searchParams.get("county"));
  const selectedCauses = parseCauses(searchParams.get("cause"));
  const panel = searchParams.get("panel");

  function updateParams(
    years: Set<number>,
    severities: Set<string>,
    counties: Set<string>,
    causes: Set<string>,
  ) {
    const params = new URLSearchParams();
    params.set("year", [...years].sort().join(","));
    params.set("severity", [...severities].map(slugify).sort().join(","));
    if (counties.size > 0) {
      params.set("county", [...counties].map(slugify).sort().join(","));
    }
    if (causes.size > 0) {
      params.set("cause", [...causes].sort().join(","));
    }
    setSearchParams(params);
  }

  function toggleYear(year: number) {
    const next = new Set(selectedYears);
    if (next.has(year)) next.delete(year);
    else next.add(year);
    updateParams(next, selectedSeverities, selectedCounties, selectedCauses);
  }

  function setYearRange(from: number, to: number) {
    const next = new Set<number>();
    for (let y = from; y <= to; y++) {
      if (YEARS.includes(y)) next.add(y);
    }
    updateParams(next, selectedSeverities, selectedCounties, selectedCauses);
  }

  function clearYears() {
    updateParams(new Set(), selectedSeverities, selectedCounties, selectedCauses);
  }

  function toggleSeverity(severity: string) {
    const next = new Set(selectedSeverities);
    if (next.has(severity)) next.delete(severity);
    else next.add(severity);
    updateParams(selectedYears, next, selectedCounties, selectedCauses);
  }

  function toggleCounty(county: string) {
    const next = new Set(selectedCounties);
    if (next.has(county)) next.delete(county);
    else next.add(county);
    updateParams(selectedYears, selectedSeverities, next, selectedCauses);
  }

  function clearCounties() {
    updateParams(selectedYears, selectedSeverities, new Set(), selectedCauses);
  }

  function toggleCause(cause: string) {
    const next = new Set(selectedCauses);
    if (next.has(cause)) next.delete(cause);
    else next.add(cause);
    updateParams(selectedYears, selectedSeverities, selectedCounties, next);
  }

  function clearFilters() {
    setSearchParams({ year: "", severity: "" }, { replace: true });
  }

  function clearPanel() {
    setSearchParams((prev) => {
      prev.delete("panel");
      return prev;
    }, { replace: true });
  }

  return {
    selectedYears,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    toggleYear,
    setYearRange,
    clearYears,
    toggleSeverity,
    toggleCounty,
    clearCounties,
    toggleCause,
    clearFilters,
    panel,
    clearPanel,
  };
}
