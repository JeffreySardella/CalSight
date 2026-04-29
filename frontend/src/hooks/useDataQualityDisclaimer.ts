import { useQuery } from "@tanstack/react-query";
import { YEARS } from "./useFilterParams";
import { API_BASE } from "../config";

type QualityRow = {
  county_code: number | null;
  year: number | null;
  age_pct: number | null;
  gender_pct: number | null;
  sobriety_pct: number | null;
};

export type DataQualityDisclaimers = {
  /** All selected years are pre-2016 — no CCRS demographic data at all. */
  preDataOnly: boolean;
  /** Selection includes some pre-2016 years (demographic charts cover 2016+ only). */
  hasPreCcrsYears: boolean;
  agePct: number | null;
  genderPct: number | null;
  /** age_pct < 50% for the current scope. */
  showAgeWarning: boolean;
  /** gender_pct < 70% for the current scope. */
  showGenderWarning: boolean;
};

function slugify(name: string) {
  return name.toLowerCase().replace(/ /g, "-");
}

export function useDataQualityDisclaimer(
  selectedYears: number[],
  selectedCounties: string[],
): DataQualityDisclaimers {
  const singleCounty = selectedCounties.length === 1 ? slugify(selectedCounties[0]) : null;

  const { data } = useQuery<QualityRow[]>({
    queryKey: singleCounty
      ? ["data-quality", "county", singleCounty]
      : ["data-quality", "statewide"],
    queryFn: async () => {
      const url = singleCounty
        ? `${API_BASE}/api/data-quality?county=${encodeURIComponent(singleCounty)}`
        : `${API_BASE}/api/data-quality`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("data-quality fetch failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const allYears = selectedYears.length === 0 || selectedYears.length === YEARS.length;
  const years = allYears ? [...YEARS] : selectedYears;
  const preDataOnly = !allYears && years.every((y) => y < 2016);
  const hasPreCcrsYears = !allYears && !preDataOnly && years.some((y) => y < 2016);

  if (!data) {
    return { preDataOnly, hasPreCcrsYears, agePct: null, genderPct: null, showAgeWarning: false, showGenderWarning: false };
  }

  // All-time row for this scope: year IS NULL
  const allTimeRow = data.find((r) => r.year === null);
  const agePct = allTimeRow?.age_pct ?? null;
  const genderPct = allTimeRow?.gender_pct ?? null;

  return {
    preDataOnly,
    hasPreCcrsYears,
    agePct,
    genderPct,
    showAgeWarning: agePct !== null && agePct < 50,
    showGenderWarning: genderPct !== null && genderPct < 70,
  };
}
