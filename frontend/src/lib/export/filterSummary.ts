/**
 * Human-readable summaries of the current filter state. Used by:
 *   - the Scope section in DataExportPanel (drives the displayed row list)
 *   - the active-filters block in the PDF report
 *   - the filename suffix on exported files
 *
 * Kept format-agnostic so the same data can render in JSX, plain text, or
 * inside a PDF cell.
 */

import {
  CA_COUNTIES,
  CAUSES,
  SEVERITIES,
  formatYearMonth,
  type DateRangeFilter,
  type YearMonth,
} from "../../hooks/useFilterParams";

// Slug -> human label, e.g. "lane-change" -> "Lane Change". Built from the
// authoritative CAUSES array so it stays in sync with the filter UI.
const CAUSE_SLUG_TO_LABEL: Record<string, string> = Object.fromEntries(
  CAUSES.map((c) => [c.value, c.label]),
);

// Condition-filter labels. Source of truth is StepConditions.tsx; mirrored
// here because that file doesn't export them and the export panel needs to
// show user-readable values.
const WEATHER_LABELS: Record<string, string> = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  fog: "Fog",
  snow: "Snow",
  wind: "Wind",
};
const LIGHTING_LABELS: Record<string, string> = {
  daylight: "Daylight",
  dark_lit: "Dark (Street Lights)",
  dark_unlit: "Dark (No Lights)",
  dusk_dawn: "Dusk / Dawn",
};
const COLLISION_TYPE_LABELS: Record<string, string> = {
  rear_end: "Rear End",
  broadside: "Broadside",
  sideswipe: "Sideswipe",
  hit_object: "Hit Object",
  head_on: "Head On",
};
const ROAD_TYPE_LABELS: Record<string, string> = {
  highway: "Highway",
  local: "Local Road",
};

export type FilterScope = {
  /** Was any dimension narrowed at all? Used for display copy. */
  hasAnyFilter: boolean;
  /** Has the user narrowed to a county OR a date range? CSV export requires
   *  this — the backend's /api/crashes endpoint rejects unfiltered bulk
   *  reads per #282 to prevent unrestricted scraping of per-row coords +
   *  alcohol/distraction flags. */
  hasScopeFilter: boolean;
  /** {label, value} pairs for table-style rendering. */
  rows: { label: string; value: string }[];
  /** Compact one-line description, e.g. "Los Angeles · 2022-01 → 2023-12 · Fatal" */
  oneLine: string;
  /** Safe-for-filename slug, e.g. "los-angeles_2022-01_2023-12_fatal" */
  filenameSuffix: string;
};

export interface FilterState {
  dateRange: DateRangeFilter | null;
  severities: Set<string>;
  counties: Set<string>;
  causes: Set<string>;
  alcohol: boolean;
  distracted: boolean;
  pedestrian: boolean;
  cyclist: boolean;
  drug: boolean;
  driverAge: string | null;
  hitRun: boolean;
  weather: Set<string>;
  lighting: Set<string>;
  collisionType: Set<string>;
  roadType: string | null;
}

const ALL = "All";

/** Display a multi-value selection. Returns "All" when nothing is narrowed,
 *  the joined list for small sets (≤ 3 by default), and "Foo, Bar +N more"
 *  beyond that so the cell stays readable but the user still sees specifics. */
function fmtList(
  selected: Set<string>,
  total: number,
  allLabel: string,
  opts: { labelMap?: Record<string, string>; threshold?: number } = {},
): string {
  const threshold = opts.threshold ?? 3;
  if (selected.size === 0 || selected.size === total) return allLabel;
  const labelFor = (v: string) => opts.labelMap?.[v] ?? v;
  const items = [...selected].map(labelFor).sort();
  if (items.length <= threshold) return items.join(", ");
  return `${items.slice(0, threshold).join(", ")} +${items.length - threshold} more`;
}

function fmtDateRange(dr: DateRangeFilter | null): string {
  if (!dr) return "All time";
  const f = (ym: YearMonth | null) => (ym ? formatYearMonth(ym) : "?");
  if (dr.start && dr.end) return `${f(dr.start)} → ${f(dr.end)}`;
  if (dr.start) return `${f(dr.start)} → present`;
  if (dr.end) return `earliest → ${f(dr.end)}`;
  return "All time";
}

function collectFlags(s: FilterState): string[] {
  const out: string[] = [];
  if (s.alcohol) out.push("Alcohol");
  if (s.distracted) out.push("Distracted");
  if (s.pedestrian) out.push("Pedestrian");
  if (s.cyclist) out.push("Cyclist");
  if (s.drug) out.push("Drug");
  if (s.hitRun) out.push("Hit & Run");
  return out;
}

export function computeFilterScope(state: FilterState): FilterScope {
  const dateLabel = fmtDateRange(state.dateRange);
  const countyLabel = fmtList(state.counties, CA_COUNTIES.length, ALL);
  const severityLabel = fmtList(state.severities, SEVERITIES.length, ALL);
  const causeLabel = fmtList(state.causes, CAUSES.length, ALL, { labelMap: CAUSE_SLUG_TO_LABEL });
  const flags = collectFlags(state);

  const rows: { label: string; value: string }[] = [
    { label: "Date range", value: dateLabel },
    { label: "County", value: countyLabel },
    { label: "Severity", value: severityLabel },
    { label: "Cause", value: causeLabel },
  ];
  if (state.driverAge) {
    rows.push({ label: "Driver age", value: state.driverAge });
  }
  if (flags.length > 0) {
    rows.push({ label: "Involvement", value: flags.join(", ") });
  }
  // Condition rows — only shown when the user narrowed them. The total
  // counts come from the label maps (which mirror StepConditions.tsx), so
  // fmtList's "size === total" branch correctly collapses to "All" if every
  // option is selected.
  if (state.weather.size > 0) {
    rows.push({
      label: "Weather",
      value: fmtList(state.weather, Object.keys(WEATHER_LABELS).length, ALL, { labelMap: WEATHER_LABELS }),
    });
  }
  if (state.lighting.size > 0) {
    rows.push({
      label: "Lighting",
      value: fmtList(state.lighting, Object.keys(LIGHTING_LABELS).length, ALL, { labelMap: LIGHTING_LABELS }),
    });
  }
  if (state.collisionType.size > 0) {
    rows.push({
      label: "Collision type",
      value: fmtList(state.collisionType, Object.keys(COLLISION_TYPE_LABELS).length, ALL, { labelMap: COLLISION_TYPE_LABELS }),
    });
  }
  if (state.roadType) {
    rows.push({
      label: "Road type",
      value: ROAD_TYPE_LABELS[state.roadType] ?? state.roadType,
    });
  }

  const hasAnyFilter =
    state.dateRange != null ||
    state.counties.size > 0 ||
    state.severities.size > 0 ||
    state.causes.size > 0 ||
    state.driverAge != null ||
    flags.length > 0 ||
    state.weather.size > 0 ||
    state.lighting.size > 0 ||
    state.collisionType.size > 0 ||
    state.roadType != null;

  // Backend gate for /api/crashes — only county or date narrows the row set
  // enough to allow a bulk read; severity/cause/flag-only filters don't.
  const hasScopeFilter = state.dateRange != null || state.counties.size > 0;

  const oneLineParts: string[] = [];
  if (state.counties.size > 0) oneLineParts.push(countyLabel);
  if (state.dateRange) oneLineParts.push(dateLabel);
  if (state.severities.size > 0 && state.severities.size < SEVERITIES.length) {
    oneLineParts.push(severityLabel);
  }
  if (flags.length > 0) oneLineParts.push(flags.join(" + "));
  const oneLine = oneLineParts.length > 0 ? oneLineParts.join(" · ") : "All California crashes";

  const filenameSuffix = (() => {
    const parts: string[] = [];
    if (state.counties.size === 1) {
      parts.push([...state.counties][0].toLowerCase().replace(/ /g, "-"));
    } else if (state.counties.size > 1) {
      parts.push(`${state.counties.size}counties`);
    }
    if (state.dateRange) {
      if (state.dateRange.start) parts.push(formatYearMonth(state.dateRange.start));
      if (state.dateRange.end) parts.push(formatYearMonth(state.dateRange.end));
    }
    if (state.severities.size === 1) {
      parts.push([...state.severities][0].toLowerCase().replace(/ /g, "-"));
    }
    return parts.length > 0 ? `_${parts.join("_")}` : "";
  })();

  return { hasAnyFilter, hasScopeFilter, rows, oneLine, filenameSuffix };
}
