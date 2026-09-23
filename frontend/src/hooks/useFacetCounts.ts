import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { formatYearMonth, slugify } from "./useFilterParams";
import type { StagedFilters } from "./useStagedFilters";

interface ConditionCounts {
  weather?: Record<string, number>;
  lighting?: Record<string, number>;
  collisionType?: Record<string, number>;
  roadType?: Record<string, number>;
  hitRun?: number;
}

interface FacetData {
  years: Record<number, number>;
  severities: Record<string, number>;
  causes: Record<string, number>;
  involvement: Record<string, number>;
  driverAge: Record<string, number>;
  conditions: ConditionCounts;
}

export interface FacetCounts extends FacetData {
  loading: boolean;
  loaded: boolean;
}

/** `county=fresno,kern` for /api/stats, or "" for statewide. */
export function countyParam(counties: ReadonlySet<string> | undefined): string {
  return counties && counties.size > 0 ? [...counties].map(slugify).sort().join(",") : "";
}

function buildParams(staged: StagedFilters, exclude: string, county: string): string {
  const p = new URLSearchParams();
  // The county picker writes the URL straight away (it isn't staged), so the
  // counts must follow it — they read statewide while Fresno was ticked.
  if (county) p.set("county", county);

  if (exclude !== "year") {
    if (staged.dateRange?.start || staged.dateRange?.end) {
      if (staged.dateRange.start) p.set("start", formatYearMonth(staged.dateRange.start));
      if (staged.dateRange.end) p.set("end", formatYearMonth(staged.dateRange.end));
    } else if (staged.selectedYears.size > 0) {
      const years = [...staged.selectedYears].sort();
      p.set("start", `${years[0]}-01`);
      p.set("end", `${years[years.length - 1]}-12`);
    }
  }
  if (exclude !== "severity" && staged.severities.size > 0) {
    p.set("severity", [...staged.severities].map((s) => s.toLowerCase().replace(/ /g, "-")).join(","));
  }
  if (exclude !== "cause" && staged.causes.size > 0) {
    p.set("cause", [...staged.causes].join(","));
  }
  if (exclude !== "alcohol" && staged.alcohol) p.set("alcohol", "true");
  if (exclude !== "distracted" && staged.distracted) p.set("distracted", "true");
  if (exclude !== "pedestrian" && staged.pedestrian) p.set("pedestrian", "true");
  if (exclude !== "cyclist" && staged.cyclist) p.set("cyclist", "true");
  if (exclude !== "drug" && staged.drug) p.set("drug", "true");
  if (exclude !== "driverAge" && staged.driverAge) p.set("driver_age", staged.driverAge);
  if (exclude !== "weather" && staged.weather.size > 0) p.set("weather", [...staged.weather].join(","));
  if (exclude !== "lighting" && staged.lighting.size > 0) p.set("lighting", [...staged.lighting].join(","));
  if (exclude !== "collisionType" && staged.collisionType.size > 0) p.set("collision_type", [...staged.collisionType].join(","));
  if (exclude !== "roadType" && staged.roadType) p.set("road_type", staged.roadType);
  if (exclude !== "hitRun" && staged.hitRun) p.set("hit_run", "true");

  return p.toString();
}

async function fetchCount(url: string): Promise<number> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.warn(`[fetchCount] ${r.status} for ${url}: ${body}`);
      return 0;
    }
    const data = await r.json();
    return data.total_crashes ?? 0;
  } catch (err) {
    console.warn(`[fetchCount] network error for ${url}:`, err);
    return 0;
  }
}

function serializeStaged(staged: StagedFilters): string[] {
  return [
    [...staged.selectedYears].sort().join(","),
    [...staged.severities].sort().join(","),
    [...staged.causes].sort().join(","),
    staged.alcohol ? "1" : "0",
    staged.distracted ? "1" : "0",
    staged.pedestrian ? "1" : "0",
    staged.cyclist ? "1" : "0",
    staged.drug ? "1" : "0",
    staged.driverAge ?? "",
    [...staged.weather].sort().join(","),
    [...staged.lighting].sort().join(","),
    [...staged.collisionType].sort().join(","),
    staged.roadType ?? "",
    staged.hitRun ? "1" : "0",
    staged.dateRange?.start?.year?.toString() ?? "",
    staged.dateRange?.start?.month?.toString() ?? "",
    staged.dateRange?.end?.year?.toString() ?? "",
    staged.dateRange?.end?.month?.toString() ?? "",
  ];
}

async function fetchAllFacets(staged: StagedFilters, county: string): Promise<FacetData> {
  const yearParams = buildParams(staged, "year", county);
  const sevParams = buildParams(staged, "severity", county);
  const causeParams = buildParams(staged, "cause", county);
  const baseParams = buildParams(staged, "", county);
  const weatherParams = buildParams(staged, "weather", county);
  const lightingParams = buildParams(staged, "lighting", county);
  const collisionParams = buildParams(staged, "collisionType", county);
  const driverAgeParams = buildParams(staged, "driverAge", county);
  const roadTypeParams = buildParams(staged, "roadType", county);
  const hitRunParams = buildParams(staged, "hitRun", county);

  const fetchJson = (url: string) =>
    fetch(url).then((r) => r.ok ? r.json() : []).catch(() => []);

  const [
    yearData, sevData, causeData,
    alcCount, distCount, pedCount, cycCount, drugCount,
    weatherData, lightingData, collisionData,
    age1621, age2234, age3549, age5064, age65p,
    roadHighway, roadLocal, hitRunCount,
  ] = await Promise.all([
    fetchJson(`${API_BASE}/api/stats?group_by=year&${yearParams}`),
    fetchJson(`${API_BASE}/api/stats?group_by=severity&${sevParams}`),
    fetchJson(`${API_BASE}/api/stats?group_by=cause&${causeParams}`),
    fetchCount(`${API_BASE}/api/stats?${baseParams}&alcohol=true`),
    fetchCount(`${API_BASE}/api/stats?${baseParams}&distracted=true`),
    fetchCount(`${API_BASE}/api/stats?${baseParams}&pedestrian=true`),
    fetchCount(`${API_BASE}/api/stats?${baseParams}&cyclist=true`),
    fetchCount(`${API_BASE}/api/stats?${baseParams}&drug=true`),
    fetchJson(`${API_BASE}/api/stats?group_by=weather&${weatherParams}`),
    fetchJson(`${API_BASE}/api/stats?group_by=lighting&${lightingParams}`),
    fetchJson(`${API_BASE}/api/stats?group_by=collision_type&${collisionParams}`),
    fetchCount(`${API_BASE}/api/stats?${driverAgeParams}&driver_age=16-21`),
    fetchCount(`${API_BASE}/api/stats?${driverAgeParams}&driver_age=22-34`),
    fetchCount(`${API_BASE}/api/stats?${driverAgeParams}&driver_age=35-49`),
    fetchCount(`${API_BASE}/api/stats?${driverAgeParams}&driver_age=50-64`),
    fetchCount(`${API_BASE}/api/stats?${driverAgeParams}&driver_age=65%2B`),
    fetchCount(`${API_BASE}/api/stats?${roadTypeParams}&road_type=highway`),
    fetchCount(`${API_BASE}/api/stats?${roadTypeParams}&road_type=local`),
    fetchCount(`${API_BASE}/api/stats?${hitRunParams}&hit_run=true`),
  ]);

  const years: Record<number, number> = {};
  for (const r of yearData) years[r.year] = r.crash_count;

  const severities: Record<string, number> = {};
  for (const r of sevData) severities[r.severity] = r.crash_count;

  const causes: Record<string, number> = {};
  for (const r of causeData) {
    const slug = (r.canonical_cause ?? "").replace(/_/g, "-");
    causes[slug] = r.crash_count;
    causes[r.canonical_cause] = r.crash_count;
  }

  return {
    years,
    severities,
    causes,
    involvement: {
      alcohol: alcCount,
      distracted: distCount,
      pedestrian: pedCount,
      cyclist: cycCount,
      drug: drugCount,
    },
    driverAge: {
      "16-21": age1621,
      "22-34": age2234,
      "35-49": age3549,
      "50-64": age5064,
      "65+": age65p,
    },
    conditions: {
      weather: Object.fromEntries(weatherData.filter((r: { value: string }) => r.value !== "unknown").map((r: { value: string; crash_count: number }) => [r.value, r.crash_count])),
      lighting: Object.fromEntries(lightingData.filter((r: { value: string }) => r.value !== "unknown").map((r: { value: string; crash_count: number }) => [r.value, r.crash_count])),
      collisionType: Object.fromEntries(collisionData.filter((r: { value: string }) => r.value !== "unknown").map((r: { value: string; crash_count: number }) => [r.value, r.crash_count])),
      roadType: { highway: roadHighway, local: roadLocal },
      hitRun: hitRunCount,
    },
  };
}

const EMPTY: FacetData = {
  years: {},
  severities: {},
  causes: {},
  involvement: {},
  driverAge: {},
  conditions: {},
};

export function useFacetCounts(staged: StagedFilters, counties?: ReadonlySet<string>): FacetCounts {
  const county = countyParam(counties);
  const queryKey = ["facet-counts", ...serializeStaged(staged), county];

  const { data, isFetching, isSuccess } = useQuery({
    queryKey,
    queryFn: () => fetchAllFacets(staged, county),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  return {
    ...(data ?? EMPTY),
    loading: isFetching,
    loaded: isSuccess || !!data,
  };
}
