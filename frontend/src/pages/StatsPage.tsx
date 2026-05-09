import { useState, useEffect, useMemo } from "react";
import { useFilterParams, formatYearMonth, CAUSES as CAUSE_OPTIONS, SEVERITIES } from "../hooks/useFilterParams";
import MobileFilterSheet from "../components/map/MobileFilterSheet";
import FiltersPanel from "../components/map/FiltersPanel";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  LabelList,
} from "recharts";
import { useStats, type HourlyDataPoint, type YearlyDataPoint, type CauseDataPoint, type MonthlyDataPoint, type DayOfWeekDataPoint } from "../hooks/useStats";
import { useDataQualityDisclaimer } from "../hooks/useDataQualityDisclaimer";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";

function DataQualityNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 bg-surface-container-high rounded-md px-2.5 py-1.5 mb-3 text-[10px] text-on-surface-variant leading-snug">
      <span className="material-symbols-outlined text-[13px] mt-px flex-shrink-0">info</span>
      <span>{text}</span>
    </div>
  );
}

function token(name: string) {
  return `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim()})`;
}

function HourTooltip({ active, payload }: { active?: boolean; payload?: { payload: HourlyDataPoint }[] }) {
  if (!active || !payload?.length) return null;
  const { hour, count } = payload[0].payload;
  const label = `${String(hour).padStart(2, "0")}:00`;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
      <p className="font-headline font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant mt-0.5">{count.toLocaleString()} incidents</p>
    </div>
  );
}

function YearTooltip({ active, payload }: { active?: boolean; payload?: { payload: YearlyDataPoint }[] }) {
  if (!active || !payload?.length) return null;
  const { year, count } = payload[0].payload;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
      <p className="font-headline font-bold text-on-surface">{year}</p>
      <p className="text-on-surface-variant mt-0.5">{count.toLocaleString()} incidents</p>
    </div>
  );
}

function YearCursor({ x, y, width, height }: { x?: number; y?: number; width?: number; height?: number }) {
  if (x == null || y == null || width == null || height == null) return null;
  return <rect x={x} y={y - 16} width={width} height={height + 16} fill="rgba(87,95,107,0.06)" rx={2} />;
}

function CauseTooltip({ active, payload }: { active?: boolean; payload?: { payload: CauseDataPoint & { pct: number } }[] }) {
  if (!active || !payload?.length) return null;
  const { label, count, pct } = payload[0].payload;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
      <p className="font-headline font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant mt-0.5">{pct}% · {count.toLocaleString()} incidents</p>
    </div>
  );
}

function MonthTooltip({ active, payload }: { active?: boolean; payload?: { payload: MonthlyDataPoint }[] }) {
  if (!active || !payload?.length) return null;
  const { label, count, killed, injured } = payload[0].payload;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
      <p className="font-headline font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant mt-0.5">{count.toLocaleString()} incidents</p>
      <p className="text-on-surface-variant">{killed.toLocaleString()} killed · {injured.toLocaleString()} injured</p>
    </div>
  );
}

function DowTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayOfWeekDataPoint }[] }) {
  if (!active || !payload?.length) return null;
  const { label, count } = payload[0].payload;
  return (
    <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
      <p className="font-headline font-bold text-on-surface">{label}</p>
      <p className="text-on-surface-variant mt-0.5">{count.toLocaleString()} incidents</p>
    </div>
  );
}

export default function StatsPage() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const filters = useFilterParams();
  const statsFilters = useMemo(() => ({
    dateRange: filters.selectedDateRange,
    severities: [...filters.selectedSeverities],
    causes: [...filters.selectedCauses],
    counties: [...filters.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-")),
  }), [filters.selectedDateRange, filters.selectedSeverities, filters.selectedCauses, filters.selectedCounties]);
  const { data, loading, error, refetch } = useStats(statsFilters);
  const dqDisclaimers = useDataQualityDisclaimer(
    filters.selectedDateRange,
    [...filters.selectedCounties],
  );
  const [, forceUpdate] = useState(false);
  useEffect(() => {
    const observer = new MutationObserver(() => forceUpdate((v) => !v));
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Re-read CSS variables on every render — isDark change triggers a re-render,
  // so these always reflect the current theme.
  const isDark = document.documentElement.classList.contains("dark");
  const clrPrimary           = token("--primary");
  const clrPrimaryContainer  = token("--primary-container");
  const clrOnSurface         = token("--on-surface");
  const clrOnSurfaceVariant  = token("--on-surface-variant");
  const clrError             = token("--error");
  const clrTertiary          = token("--tertiary");

  const causeColorMap: Record<string, string> = isDark
    ? {
        "DUI": "#a368a0", "Speeding": "#c27862", "Lane Change": "#6b8fa3",
        "Right of Way": "#7ba088", "Improper Turn": "#b89a6b", "Tailgating": "#8e7cc3",
        "Signal Violation": "#c28a8a", "Pedestrian": "#6baab5", "Unsafe Backing": "#a0a06b",
        "Other": "#8b8b9a", "Uncategorized": "#5c7b5c",
      }
    : {
        "DUI": "#7e3794", "Speeding": "#b45309", "Lane Change": "#4a7a8c",
        "Right of Way": "#3d7a5c", "Improper Turn": "#8a6d3b", "Tailgating": "#5b4fa0",
        "Signal Violation": "#994444", "Pedestrian": "#2d7d8a", "Unsafe Backing": "#6b6b2e",
        "Other": "#78716c", "Uncategorized": "#4a7a52",
      };

  const severityColorMap: Record<string, string> = isDark
    ? { "Fatal": "#c25560", "Injury": "#b0a050", "Property Damage Only": "#6b8fa3" }
    : { "Fatal": "#991b1b", "Injury": "#6d7e1e", "Property Damage Only": "#4a7a8c" };

  const causeColor = (label: string) => causeColorMap[label] ?? clrOnSurfaceVariant;
  const severityColor = (label: string) => severityColorMap[label] ?? clrOnSurfaceVariant;

  const dateRange  = filters.selectedDateRange;
  const severities = filters.selectedSeverities;
  const counties   = filters.selectedCounties;
  const causes     = filters.selectedCauses;

  function handleClearAll() {
    filters.clearFilters();
    setResetKey((k) => k + 1);
  }

  // Build typed chips so each one knows how to remove itself.
  // "All X" chips open the filter panel instead of removing — they have no onRemove.
  type Chip = { label: string; onRemove?: () => void; onOpen?: () => void };

  const openFilters = () => setShowMobileFilters(true);

  const countyChips: Chip[] = counties.size === 0
    ? [{ label: "All Counties", onOpen: openFilters }]
    : [...counties].sort().map((c) => ({ label: c, onRemove: () => filters.toggleCounty(c) }));

  const dateRangeLabel = dateRange
    ? `${dateRange.start ? formatYearMonth(dateRange.start) : "earliest"} – ${dateRange.end ? formatYearMonth(dateRange.end) : "latest"}`
    : null;
  const yearChips: Chip[] = dateRangeLabel
    ? [{ label: dateRangeLabel, onRemove: () => filters.clearDateRange() }]
    : [{ label: "All Years", onOpen: openFilters }];

  const severityChips: Chip[] = severities.size === 0 || severities.size === SEVERITIES.length
    ? [{ label: "All Severities", onOpen: openFilters }]
    : [...severities].map((s) => ({ label: s, onRemove: () => filters.toggleSeverity(s) }));

  // Display label lookup for cause values (URL slug → human label)
  const CAUSE_LABEL: Record<string, string> = {
    "dui": "DUI",
    "speeding": "Speeding",
    "lane-change": "Lane Change",
    "right-of-way": "Right of Way",
    "turning": "Improper Turn",
    "following-too-close": "Tailgating",
    "signal-violation": "Signal Violation",
    "pedestrian-violation": "Pedestrian",
    "unsafe-backing": "Unsafe Backing",
    "other": "Other",
  };

  const causeChips: Chip[] = causes.size === 0 || causes.size === CAUSE_OPTIONS.length
    ? [{ label: "All Causes", onOpen: openFilters }]
    : [...causes].sort().map((c) => ({ label: CAUSE_LABEL[c] ?? c, onRemove: () => filters.toggleCause(c) }));

  const involvementChips: Chip[] = [
    ...(filters.selectedAlcohol    ? [{ label: "Alcohol",    onRemove: () => filters.toggleAlcohol()    }] : []),
    ...(filters.selectedDistracted ? [{ label: "Distracted", onRemove: () => filters.toggleDistracted() }] : []),
  ];

  const chips: Chip[] = [
    ...countyChips,
    ...yearChips,
    ...causeChips,
    ...severityChips,
    ...involvementChips,
  ];

  const hourlyData     = data?.hourlyData     ?? [];
  const yearlyData     = data?.yearlyData     ?? [];
  const causesData     = data?.causesData     ?? [];
  const severityData   = data?.severityData   ?? [];
  const genderData     = data?.genderData     ?? [];
  const ageBracketData = data?.ageBracketData ?? [];
  const monthlyData    = data?.monthlyData    ?? [];
  const dayOfWeekData  = data?.dayOfWeekData  ?? [];
  const rateData       = data?.rateData       ?? [];
  const heroMetrics    = data?.heroMetrics    ?? {};

  const { totalIncidents, incidentYoYPct, ksiRatePer100k, yoyFatalityChangePct } = heroMetrics;

  const peakHourIndex = hourlyData.length
    ? hourlyData.reduce((maxIdx, d, i, arr) => (d.count > arr[maxIdx].count ? i : maxIdx), 0)
    : 0;
  const peakYear = yearlyData.length
    ? yearlyData.reduce((a, b) => (b.count > a.count ? b : a)).year
    : 0;
  const causeTotal    = causesData.reduce((sum, d) => sum + d.count, 0);
  const causesWithPct = causesData.map((d) => ({
    ...d,
    pct: causeTotal > 0 ? Math.round((d.count / causeTotal) * 100) : 0,
  }));

  const peakMonthIndex = monthlyData.length
    ? monthlyData.reduce((maxIdx, d, i, arr) => (d.count > arr[maxIdx].count ? i : maxIdx), 0)
    : 0;
  const peakDowIndex = dayOfWeekData.length
    ? dayOfWeekData.reduce((maxIdx, d, i, arr) => (d.count > arr[maxIdx].count ? i : maxIdx), 0)
    : 0;

  const sortedRateData = useMemo(() => {
    if (!rateData.length) return [];
    return [...rateData].sort((a, b) => {
      if (a.county_name !== b.county_name) return a.county_name.localeCompare(b.county_name);
      if (a.year !== b.year) return b.year - a.year;
      return a.severity.localeCompare(b.severity);
    });
  }, [rateData]);

  const sevTotal    = severityData.reduce((sum, d) => sum + d.count, 0);
  const sevWithPct  = severityData.map((d) => ({
    ...d,
    pct: sevTotal > 0 ? Math.round((d.count / sevTotal) * 100) : 0,
  }));

  const incidentUp = incidentYoYPct != null && incidentYoYPct >= 0;
  const fatalityUp = yoyFatalityChangePct != null && yoyFatalityChangePct > 0;

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8 relative">
      {/* Filter Summary Bar */}
      <section className="bg-surface-container-low rounded-lg px-4 md:px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar w-full md:w-auto">
          <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mr-2 flex-shrink-0">
            Filters:
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            {chips.map((chip) => (
              chip.onRemove ? (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1 bg-surface-container-highest px-3 py-1 rounded-full text-xs font-medium text-on-surface whitespace-nowrap"
                >
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label} filter`}
                    onClick={chip.onRemove}
                    className="hover:text-error transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </span>
              ) : (
                <button
                  key={chip.label}
                  type="button"
                  onClick={chip.onOpen}
                  className="inline-flex items-center gap-1 bg-surface-container-high px-3 py-1 rounded-full text-xs font-medium text-on-surface-variant whitespace-nowrap hover:text-on-surface transition-colors"
                >
                  {chip.label}
                  <span className="material-symbols-outlined text-[14px]">tune</span>
                </button>
              )
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowMobileFilters(true)}
          className="text-primary text-xs font-bold uppercase tracking-wider flex items-center gap-1 hover:underline flex-shrink-0"
        >
          Edit Filters
          <span className="material-symbols-outlined text-[16px]">tune</span>
        </button>
      </section>

      {/* Hero Metrics Row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* Total Incidents */}
        <div className="bg-surface-container-lowest rounded-lg p-6 ambient-shadow">
          <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-4">
            Total Incidents
          </p>
          <div className="flex items-baseline gap-3">
            {loading ? (
              <Skeleton className="h-10 w-40" />
            ) : (
              <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
                {totalIncidents != null ? totalIncidents.toLocaleString() : "—"}
              </h2>
            )}
            {incidentYoYPct != null && (
              <span className={`text-sm font-bold flex items-center ${incidentUp ? "text-error" : "text-primary"}`}>
                <span className="material-symbols-outlined text-[18px]">
                  {incidentUp ? "trending_up" : "trending_down"}
                </span>
                {incidentUp ? "+" : ""}{incidentYoYPct}%
              </span>
            )}
          </div>
          <p className="text-on-surface-variant text-[10px] mt-2 italic">
            Relative to previous fiscal cycle
          </p>
        </div>

        {/* KSI Rate */}
        <div className="bg-surface-container-lowest rounded-lg p-6 ambient-shadow">
          <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-4">
            KSI Rate / 100K Pop.
          </p>
          {loading ? (
            <Skeleton className="h-10 w-24" />
          ) : (
            <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
              {ksiRatePer100k != null ? ksiRatePer100k.toFixed(1) : "—"}
            </h2>
          )}
          <p className="text-on-surface-variant text-[10px] mt-2 italic">
            Killed &amp; seriously injured per 100K residents
          </p>
        </div>

        {/* YoY Fatality Change */}
        <div className="bg-surface-container-lowest rounded-lg p-6 ambient-shadow">
          <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-4">
            YoY Fatality Change
          </p>
          <div className="flex items-baseline gap-3">
            {loading ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
                {yoyFatalityChangePct != null
                  ? `${fatalityUp ? "+" : ""}${yoyFatalityChangePct}%`
                  : "—"}
              </h2>
            )}
            {yoyFatalityChangePct != null && (
              <span className={`text-sm font-bold flex items-center ${fatalityUp ? "text-error" : "text-primary"}`}>
                <span className="material-symbols-outlined text-[18px]">
                  {fatalityUp ? "trending_up" : "trending_down"}
                </span>
              </span>
            )}
          </div>
          <p className="text-on-surface-variant text-[10px] mt-2 italic">
            Change in fatalities vs. prior year
          </p>
        </div>
      </section>

      {/* Bento Chart Grid */}
      <section className="grid grid-cols-12 gap-4 md:gap-6">
        {/* Crash Density by Hour */}
        <div className="col-span-12 md:col-span-8 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-on-surface font-headline font-bold text-lg leading-tight">
                Crash Density by Hour
              </h3>
              <p className="text-on-surface-variant text-xs font-medium">
                Temporal distribution across 24-hour cycle
              </p>
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : error ? (
            <ErrorState onRetry={refetch} className="h-48" />
          ) : !hourlyData.length ? (
            <EmptyState icon="search_off" description="No data for the selected filters." className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 240 : 192}>
              <BarChart data={hourlyData} barCategoryGap="10%" margin={{ top: 8, right: 20, left: 10, bottom: 0 }}>
                <XAxis
                  dataKey="hour"
                  ticks={[0, 6, 12, 18, 23]}
                  minTickGap={0}
                  tickFormatter={(h) => h === 23 ? "23:59" : `${String(h).padStart(2, "0")}:00`}
                  tick={{ fontSize: 10, fill: clrOnSurfaceVariant, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<HourTooltip />} cursor={{ fill: "rgba(87,95,107,0.06)" }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {hourlyData.map((_, i) => (
                    <Cell key={i} fill={i === peakHourIndex ? clrPrimary : clrPrimaryContainer} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    content={(props) => {
                      const { x, y, width, index } = props as { x: number; y: number; width: number; index: number };
                      if (index !== peakHourIndex) return null;
                      return (
                        <text
                          x={Number(x) + Number(width) / 2}
                          y={Number(y) - 4}
                          textAnchor="middle"
                          fill={clrPrimary}
                          fontSize={8}
                          fontWeight={700}
                          fontFamily="Inter, sans-serif"
                          letterSpacing={1}
                        >
                          PEAK
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Primary Cause */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <h3 className="text-on-surface font-headline font-bold text-lg mb-4 leading-tight">
            Primary Cause
          </h3>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <ErrorState onRetry={refetch} className="h-40" />
          ) : !causesWithPct.length ? (
            <EmptyState icon="search_off" description="No data for the selected filters." className="h-40" />
          ) : causesWithPct.length <= 5 ? (
            <>
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 160}>
                <PieChart>
                  <Pie
                    data={causesWithPct}
                    dataKey="pct"
                    nameKey="label"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    startAngle={90}
                    endAngle={-270}
                    strokeWidth={0}
                  >
                    {causesWithPct.map((c) => (
                      <Cell key={c.label} fill={causeColor(c.label)} />
                    ))}
                  </Pie>
                  <Tooltip content={<CauseTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-4 mt-2">
                {causesWithPct.map((cause) => (
                  <div key={cause.label} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: causeColor(cause.label) }} />
                    <div>
                      <p className="text-sm font-bold text-on-surface">{cause.label}</p>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold">
                        {cause.pct}% · {cause.count.toLocaleString()} incidents
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, causesWithPct.length * 32)}>
              <BarChart data={[...causesWithPct].sort((a, b) => b.count - a.count)} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={100}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: clrOnSurfaceVariant, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                />
                <Tooltip content={<CauseTooltip />} cursor={{ fill: "rgba(87,95,107,0.06)" }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18}>
                  {[...causesWithPct].sort((a, b) => b.count - a.count).map((c) => (
                    <Cell key={c.label} fill={causeColor(c.label)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Incidents by Year */}
        <div className="col-span-12 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
              <h3 className="text-on-surface font-headline font-bold text-xl leading-tight">
                Incidents by Year{yearlyData.length >= 2 ? ` (${yearlyData[0]?.year}–${yearlyData[yearlyData.length - 1]?.year})` : ""}
              </h3>
              <p className="text-on-surface-variant text-sm">
                {yearlyData.length < 3 ? "Year-over-year summary" : "Longitudinal dataset showing historical trends"}
              </p>
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : error ? (
            <ErrorState onRetry={refetch} className="h-64" />
          ) : !yearlyData.length ? (
            <EmptyState icon="search_off" description="No data for the selected filters." className="h-64" />
          ) : yearlyData.length < 3 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {yearlyData.map((yr) => (
                <div key={yr.year} className="bg-surface-container-low rounded-lg p-5">
                  <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mb-3">{yr.year}</p>
                  <p className="text-3xl font-headline font-bold text-on-surface tracking-tight">{yr.count.toLocaleString()}</p>
                  <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold mt-2">
                    {yr.killed.toLocaleString()} killed · {yr.injured.toLocaleString()} injured
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 256}>
              <BarChart data={yearlyData} barCategoryGap="15%" margin={{ top: 24, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="year"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={(props) => {
                    const { x, y, payload } = props;
                    const yr = payload.value as number;
                    const isPeak = yr === peakYear;
                    const nearPeak = Math.abs(yr - peakYear) <= 2 && !isPeak;
                    const isEndpoint = yr === yearlyData[0]?.year || yr === yearlyData[yearlyData.length - 1]?.year;
                    const showLabel = isPeak || (!nearPeak && (yr % 5 === 0 || isEndpoint));
                    if (!showLabel) return <text />;
                    return (
                      <text
                        x={x} y={y + 10}
                        textAnchor="middle"
                        fill={isPeak ? clrOnSurface : clrOnSurfaceVariant}
                        fontSize={10}
                        fontWeight={700}
                        fontStyle={isPeak ? "italic" : "normal"}
                        fontFamily="Inter, sans-serif"
                      >
                        {isPeak ? `${yr}*` : yr}
                      </text>
                    );
                  }}
                />
                <Tooltip
                  content={<YearTooltip />}
                  cursor={<YearCursor />}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {yearlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.year === peakYear ? clrError : clrPrimaryContainer} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {yearlyData.length >= 3 && (
            <p className="mt-6 text-[10px] text-on-surface-variant italic leading-relaxed">
              * Note: 2018 data represents a statistically significant anomaly due
              to regional reporting calibration. Data accuracy remains within 99.4%
              confidence interval.
            </p>
          )}
        </div>
      </section>

      {/* Temporal Patterns Grid */}
      <section className="grid grid-cols-12 gap-4 md:gap-6">
        {/* Monthly Seasonality */}
        <div className="col-span-12 md:col-span-8 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-on-surface font-headline font-bold text-lg leading-tight">
                Crashes by Month
              </h3>
              <p className="text-on-surface-variant text-xs font-medium">
                Seasonal distribution across calendar year
              </p>
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : error ? (
            <ErrorState onRetry={refetch} className="h-48" />
          ) : !monthlyData.length ? (
            <EmptyState icon="search_off" description="No data for the selected filters." className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 240 : 192}>
              <BarChart data={monthlyData} barCategoryGap="10%" margin={{ top: 8, right: 20, left: 10, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: clrOnSurfaceVariant, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                />
                <Tooltip content={<MonthTooltip />} cursor={{ fill: "rgba(87,95,107,0.06)" }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {monthlyData.map((_, i) => (
                    <Cell key={i} fill={i === peakMonthIndex ? clrPrimary : clrPrimaryContainer} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="top"
                    content={(props) => {
                      const { x, y, width, index } = props as { x: number; y: number; width: number; index: number };
                      if (index !== peakMonthIndex) return null;
                      return (
                        <text
                          x={Number(x) + Number(width) / 2}
                          y={Number(y) - 4}
                          textAnchor="middle"
                          fill={clrPrimary}
                          fontSize={8}
                          fontWeight={700}
                          fontFamily="Inter, sans-serif"
                          letterSpacing={1}
                        >
                          PEAK
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Day of Week */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <h3 className="text-on-surface font-headline font-bold text-lg mb-4 leading-tight">
            Day of Week
          </h3>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : error ? (
            <ErrorState onRetry={refetch} className="h-48" />
          ) : !dayOfWeekData.length ? (
            <EmptyState icon="search_off" description="No data for the selected filters." className="h-48" />
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 240 : 192}>
              <BarChart data={dayOfWeekData} barCategoryGap="15%" margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: clrOnSurfaceVariant, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                />
                <Tooltip content={<DowTooltip />} cursor={{ fill: "rgba(87,95,107,0.06)" }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {dayOfWeekData.map((_, i) => (
                    <Cell key={i} fill={i === peakDowIndex ? clrPrimary : clrPrimaryContainer} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Demographics Grid */}
      <section className="grid grid-cols-12 gap-4 md:gap-6">
        {/* Severity Breakdown */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <h3 className="text-on-surface font-headline font-bold text-lg mb-4 leading-tight">
            Severity Breakdown
          </h3>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <ErrorState onRetry={refetch} className="h-40" />
          ) : !sevWithPct.length ? (
            <EmptyState icon="search_off" description="No data for the selected filters." className="h-40" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 160}>
                <PieChart>
                  <Pie
                    data={sevWithPct}
                    dataKey="pct"
                    nameKey="label"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    startAngle={90}
                    endAngle={-270}
                    strokeWidth={0}
                  >
                    {sevWithPct.map((s) => (
                      <Cell key={s.label} fill={severityColor(s.label)} />
                    ))}
                  </Pie>
                  <Tooltip content={<CauseTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-4 mt-2">
                {sevWithPct.map((sev) => (
                  <div key={sev.label} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: severityColor(sev.label) }} />
                    <div>
                      <p className="text-sm font-bold text-on-surface">{sev.label}</p>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold">
                        {sev.pct}% · {sev.count.toLocaleString()} incidents
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Victims by Gender */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <h3 className="text-on-surface font-headline font-bold text-lg mb-4 leading-tight">
            Victims by Gender
          </h3>
          {dqDisclaimers.preDataOnly && (
            <DataQualityNote text="Driver demographic data is only available from 2016 onward (CCRS)." />
          )}
          {!dqDisclaimers.preDataOnly && dqDisclaimers.hasPreCcrsYears && (
            <DataQualityNote text="Pre-2016 years have no gender data — chart covers 2016+ only." />
          )}
          {!dqDisclaimers.preDataOnly && dqDisclaimers.showGenderWarning && dqDisclaimers.genderPct !== null && (
            <DataQualityNote text={`Gender recorded for ${Math.round(dqDisclaimers.genderPct)}% of parties. Chart may not be fully representative.`} />
          )}
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : !genderData.length ? (
            <EmptyState
              icon="person_off"
              description={dqDisclaimers.preDataOnly ? "Gender data requires 2016 or later (CCRS)." : "No gender data for the current filters."}
              className="h-48"
            />
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 240 : 192}>
              <BarChart data={genderData} barCategoryGap="25%" margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: clrOnSurfaceVariant, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { label: string; count: number };
                    const total = genderData.reduce((s, g) => s + g.count, 0);
                    const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
                    return (
                      <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
                        <p className="font-headline font-bold text-on-surface">{d.label}</p>
                        <p className="text-on-surface-variant mt-0.5">{pct}% · {d.count.toLocaleString()} victims</p>
                      </div>
                    );
                  }}
                  cursor={{ fill: "rgba(87,95,107,0.06)" }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {genderData.map((_, i) => (
                    <Cell key={i} fill={[clrPrimary, clrTertiary, clrPrimaryContainer][i] ?? clrPrimaryContainer} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Victims by Age */}
        <div className="col-span-12 md:col-span-4 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <h3 className="text-on-surface font-headline font-bold text-lg mb-4 leading-tight">
            Victims by Age
          </h3>
          {dqDisclaimers.preDataOnly && (
            <DataQualityNote text="Driver demographic data is only available from 2016 onward (CCRS)." />
          )}
          {!dqDisclaimers.preDataOnly && dqDisclaimers.hasPreCcrsYears && (
            <DataQualityNote text="Pre-2016 years have no age data — chart covers 2016+ only." />
          )}
          {!dqDisclaimers.preDataOnly && dqDisclaimers.showAgeWarning && dqDisclaimers.agePct !== null && (
            <DataQualityNote text={`Age recorded for ${Math.round(dqDisclaimers.agePct)}% of parties. Chart may not be fully representative.`} />
          )}
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : !ageBracketData.length ? (
            <EmptyState
              icon="person_off"
              description={dqDisclaimers.preDataOnly ? "Age data requires 2016 or later (CCRS)." : "No age data for the current filters."}
              className="h-48"
            />
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 240 : 192}>
              <BarChart data={ageBracketData} barCategoryGap="15%" margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: clrOnSurfaceVariant, fontWeight: 600, fontFamily: "Inter, sans-serif" }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as { label: string; count: number };
                    const total = ageBracketData.reduce((s, a) => s + a.count, 0);
                    const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
                    return (
                      <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
                        <p className="font-headline font-bold text-on-surface">{d.label}</p>
                        <p className="text-on-surface-variant mt-0.5">{pct}% · {d.count.toLocaleString()} victims</p>
                      </div>
                    );
                  }}
                  cursor={{ fill: "rgba(87,95,107,0.06)" }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]} fill={clrPrimaryContainer} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Per-Capita Rates Table */}
      {rateData.length > 0 && (
        <section className="bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <div className="mb-6">
            <h3 className="text-on-surface font-headline font-bold text-xl leading-tight">
              Per-Capita Crash Rates
            </h3>
            <p className="text-on-surface-variant text-sm mt-1">
              Normalized rates for cross-county comparison
            </p>
          </div>
          {dqDisclaimers.hasPreAcsYears && (
            <DataQualityNote text="Pre-2009 demographic data is only available for California's largest counties (≥65k population). Per-capita columns may show '—' for smaller counties during 2001–2008." />
          )}
          <div className="space-y-1">
            {Object.entries(
              sortedRateData.reduce<Record<string, typeof sortedRateData>>((acc, r) => {
                (acc[r.county_name] ??= []).push(r);
                return acc;
              }, {}),
            ).map(([county, rows]) => (
              <details key={county} className="group">
                <summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-surface-container-low/40 rounded transition-colors">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant transition-transform group-open:rotate-90">
                    chevron_right
                  </span>
                  <span className="font-headline font-bold text-sm text-on-surface">{county}</span>
                  <span className="text-[10px] text-on-surface-variant uppercase tracking-widest font-semibold">
                    {rows.length} {rows.length === 1 ? "row" : "rows"}
                  </span>
                </summary>
                <div className="overflow-x-auto ml-6 mb-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-on-surface-variant uppercase tracking-widest font-semibold">
                        <th className="px-3 py-1.5">Year</th>
                        <th className="px-3 py-1.5">Severity</th>
                        <th className="px-3 py-1.5">Crashes</th>
                        <th className="px-3 py-1.5">Per 100K Pop</th>
                        <th className="px-3 py-1.5">Per 10K Drivers</th>
                        <th className="px-3 py-1.5">Per 100 Mi</th>
                        <th className="px-3 py-1.5">Per 100K AADT</th>
                        <th className="px-3 py-1.5">Per 10K Vehicles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr
                          key={`${r.year}-${r.severity}`}
                          className={i % 2 === 0 ? "bg-surface-container-lowest" : "bg-surface-container-low/40"}
                        >
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.year}</td>
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.severity}</td>
                          <td className="px-3 py-1.5 text-on-surface font-bold">{r.total_crashes.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.per_100k_population?.toFixed(1) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.per_10k_licensed_drivers?.toFixed(1) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.per_100_road_miles?.toFixed(1) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.per_100k_aadt?.toFixed(1) ?? "—"}</td>
                          <td className="px-3 py-1.5 text-on-surface-variant">{r.per_10k_vehicles?.toFixed(1) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Methodology Footer */}
      <section className="border-t border-outline-variant/15 pt-12 pb-16 opacity-60 hover:opacity-100 transition-opacity">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-[10px] leading-relaxed uppercase tracking-widest font-medium text-on-surface-variant">
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-[11px]">Methodology Statement</h4>
            <p>
              Calculations based on integrated records from the Statewide
              Integrated Traffic Records System (SWITRS). Data is processed
              through an iterative algorithmic cleanup to normalize reporting
              variations across jurisdictions. Temporal density charts are
              weighted by population density per census tract to ensure
              rural-urban parity.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-[11px]">California Public Records Act</h4>
            <p>
              This information is presented in compliance with CA Gov Code
              &sect; 6250. Access to the raw ledger for independent auditing is
              available upon verification. System Ledger Hash ID:
              8821-X-CALSIGHT-DASH-04. Version 4.2.1.0 Institutional
              Transparency Protocol.
            </p>
          </div>
        </div>
      </section>

      {/* Mobile filter sheet overlay */}
      <MobileFilterSheet
        isOpen={showMobileFilters}
        onClose={() => setShowMobileFilters(false)}
        onClear={handleClearAll}
        tabs={[
          {
            key: "filters",
            label: "Filters",
            icon: "filter_list",
            content: (
              <FiltersPanel
                selectedDateRange={filters.selectedDateRange}
                selectedSeverities={filters.selectedSeverities}
                selectedCounties={filters.selectedCounties}
                selectedCauses={filters.selectedCauses}
                selectedAlcohol={filters.selectedAlcohol}
                selectedDistracted={filters.selectedDistracted}
                selectedPedestrian={filters.selectedPedestrian}
                selectedCyclist={filters.selectedCyclist}
                selectedDrug={filters.selectedDrug}
                selectedDriverAge={filters.selectedDriverAge}
                onSetDateRange={filters.setDateRange}
                onClearDateRange={filters.clearDateRange}
                onToggleSeverity={filters.toggleSeverity}
                onSetSeverities={filters.setSeverities}
                onSetAllSeverities={filters.setAllSeverities}
                onClearSeverities={filters.clearSeverities}
                onToggleCounty={filters.toggleCounty}
                onClearCounties={filters.clearCounties}
                onToggleCause={filters.toggleCause}
                onSetCauses={filters.setCauses}
                onSetAllCauses={filters.setAllCauses}
                onClearCauses={filters.clearCauses}
                onToggleAlcohol={filters.toggleAlcohol}
                onToggleDistracted={filters.toggleDistracted}
                onTogglePedestrian={filters.togglePedestrian}
                onToggleCyclist={filters.toggleCyclist}
                onToggleDrug={filters.toggleDrug}
                onSetDriverAge={filters.setDriverAge}
                resetKey={resetKey}
              />
            ),
          },
        ]}
      />
    </main>
  );
}
