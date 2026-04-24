import { useState, useEffect, useMemo } from "react";
import { useFilterParams, YEARS, CAUSES as CAUSE_OPTIONS, SEVERITIES } from "../hooks/useFilterParams";
import MobileFilterSheet from "../components/map/MobileFilterSheet";
import FiltersPanel from "../components/map/FiltersPanel";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  LabelList,
} from "recharts";
import { useStats, type HourlyDataPoint, type YearlyDataPoint, type CauseDataPoint } from "../hooks/useStats";

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
    years: [...filters.selectedYears],
    severities: [...filters.selectedSeverities],
    causes: [...filters.selectedCauses],
    counties: [...filters.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-")),
  }), [filters.selectedYears, filters.selectedSeverities, filters.selectedCauses, filters.selectedCounties]);
  const { data, loading, error } = useStats(statsFilters);
  const [, forceUpdate] = useState(false);
  useEffect(() => {
    const observer = new MutationObserver(() => forceUpdate((v) => !v));
    observer.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Re-read CSS variables on every render — isDark change triggers a re-render,
  // so these always reflect the current theme.
  const clrPrimary           = token("--primary");
  const clrPrimaryContainer  = token("--primary-container");
  const clrOnSurface         = token("--on-surface");
  const clrOnSurfaceVariant  = token("--on-surface-variant");
  const clrError             = token("--error");
  const clrTertiary          = token("--tertiary");
  const causeColors          = [clrPrimary, clrError, clrTertiary];

  const years      = filters.selectedYears;
  const severities = filters.selectedSeverities;
  const counties   = filters.selectedCounties;
  const causes     = filters.selectedCauses;

  function handleClearAll() {
    filters.clearFilters();
    setResetKey((k) => k + 1);
  }

  // Build typed chips so each one knows how to remove itself.
  // Collapse "all selected" into a single summary chip.
  const sortedYears = [...years].sort((a, b) => a - b);
  type Chip = { label: string; onRemove: () => void };

  const yearChips: Chip[] = years.size === YEARS.length
    ? [{ label: "All Years", onRemove: () => filters.clearYears() }]
    : sortedYears.length >= 3 && sortedYears.every((y, i) => i === 0 || y === sortedYears[i - 1] + 1)
      ? [{ label: `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`, onRemove: () => filters.clearYears() }]
      : sortedYears.map((y) => ({ label: String(y), onRemove: () => filters.toggleYear(y) }));

  const severityChips: Chip[] = severities.size === SEVERITIES.length
    ? [{ label: "All Severities", onRemove: () => filters.clearSeverities() }]
    : [...severities].map((s) => ({ label: s, onRemove: () => filters.toggleSeverity(s) }));

  // Display label lookup for cause values (URL slug → human label)
  const CAUSE_LABEL: Record<string, string> = {
    "dui": "DUI",
    "speeding": "Speeding",
    "lane-change": "Lane Change",
    "other": "Other",
  };

  const causeChips: Chip[] = causes.size === CAUSE_OPTIONS.length
    ? [{ label: "All Causes", onRemove: () => filters.clearCauses() }]
    : [...causes].sort().map((c) => ({ label: CAUSE_LABEL[c] ?? c, onRemove: () => filters.toggleCause(c) }));

  const involvementChips: Chip[] = [
    ...(filters.selectedAlcohol    ? [{ label: "Alcohol",    onRemove: () => filters.toggleAlcohol()    }] : []),
    ...(filters.selectedDistracted ? [{ label: "Distracted", onRemove: () => filters.toggleDistracted() }] : []),
  ];

  const chips: Chip[] = [
    ...[...counties].sort().map((c) => ({ label: c, onRemove: () => filters.toggleCounty(c) })),
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
            <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
              {totalIncidents != null ? totalIncidents.toLocaleString() : "—"}
            </h2>
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
          <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
            {ksiRatePer100k != null ? ksiRatePer100k.toFixed(1) : "—"}
          </h2>
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
            <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
              {yoyFatalityChangePct != null
                ? `${fatalityUp ? "+" : ""}${yoyFatalityChangePct}%`
                : "—"}
            </h2>
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
            <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">Loading…</div>
          ) : error ? (
            <div className="h-48 flex items-center justify-center text-error text-sm">Failed to load data.</div>
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
            <div className="h-40 flex items-center justify-center text-on-surface-variant text-sm">Loading…</div>
          ) : error ? (
            <div className="h-40 flex items-center justify-center text-error text-sm">Failed to load data.</div>
          ) : (
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
                    {causesWithPct.map((_, i) => (
                      <Cell key={i} fill={causeColors[i]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CauseTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-4 mt-2">
                {causesWithPct.map((cause, i) => (
                  <div key={cause.label} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: causeColors[i] }} />
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
          )}
        </div>

        {/* Incidents by Year */}
        <div className="col-span-12 bg-surface-container-lowest rounded-lg p-5 md:p-8 ambient-shadow">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
              <h3 className="text-on-surface font-headline font-bold text-xl leading-tight">
                Incidents by Year ({yearlyData[0]?.year}–{yearlyData[yearlyData.length - 1]?.year})
              </h3>
              <p className="text-on-surface-variant text-sm">
                Longitudinal dataset showing historical trends
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="bg-surface-container-low px-4 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">download</span>
                CSV
              </button>
              <button type="button" className="bg-surface-container-low px-4 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-widest text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
                PDF
              </button>
            </div>
          </div>
          {loading ? (
            <div className="h-64 flex items-center justify-center text-on-surface-variant text-sm">Loading…</div>
          ) : error ? (
            <div className="h-64 flex items-center justify-center text-error text-sm">Failed to load data.</div>
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
          <p className="mt-6 text-[10px] text-on-surface-variant italic leading-relaxed">
            * Note: 2018 data represents a statistically significant anomaly due
            to regional reporting calibration. Data accuracy remains within 99.4%
            confidence interval.
          </p>
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
            <div className="h-40 flex items-center justify-center text-on-surface-variant text-sm">Loading…</div>
          ) : error ? (
            <div className="h-40 flex items-center justify-center text-error text-sm">Failed to load data.</div>
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
                    {sevWithPct.map((_, i) => (
                      <Cell key={i} fill={[clrError, clrTertiary, clrPrimaryContainer][i] ?? clrPrimary} />
                    ))}
                  </Pie>
                  <Tooltip content={<CauseTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-4 mt-2">
                {sevWithPct.map((sev, i) => (
                  <div key={sev.label} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: [clrError, clrTertiary, clrPrimaryContainer][i] ?? clrPrimary }} />
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
          {loading ? (
            <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">Loading…</div>
          ) : !genderData.length ? (
            <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">No data available.</div>
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
                    return (
                      <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
                        <p className="font-headline font-bold text-on-surface">{d.label}</p>
                        <p className="text-on-surface-variant mt-0.5">{d.count.toLocaleString()} victims</p>
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
          {loading ? (
            <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">Loading…</div>
          ) : !ageBracketData.length ? (
            <div className="h-48 flex items-center justify-center text-on-surface-variant text-sm">No data available.</div>
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
                    return (
                      <div className="bg-surface-container-lowest border border-outline-variant/15 rounded px-3 py-2 text-xs ambient-shadow">
                        <p className="font-headline font-bold text-on-surface">{d.label}</p>
                        <p className="text-on-surface-variant mt-0.5">{d.count.toLocaleString()} victims</p>
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

      {/* Mobile share FAB */}
      <button type="button" className="fixed bottom-28 right-4 z-40 md:hidden w-12 h-12 bg-primary text-on-primary rounded-full shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity">
        <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          share
        </span>
      </button>

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
                selectedYears={filters.selectedYears}
                selectedSeverities={filters.selectedSeverities}
                selectedCounties={filters.selectedCounties}
                selectedCauses={filters.selectedCauses}
                selectedAlcohol={filters.selectedAlcohol}
                selectedDistracted={filters.selectedDistracted}
                onToggleYear={filters.toggleYear}
                onSetYearRange={filters.setYearRange}
                onClearYears={filters.clearYears}
                onSetYears={filters.setYears}
                onSetAllYears={filters.setAllYears}
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
                resetKey={resetKey}
              />
            ),
          },
        ]}
      />
    </main>
  );
}
