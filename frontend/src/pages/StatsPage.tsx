import { useState, useEffect, useMemo, useCallback } from "react";
import { useFilterParams, formatYearMonth, CAUSES as CAUSE_OPTIONS, SEVERITIES, YEARS } from "../hooks/useFilterParams";
import MobileFilterSheet from "../components/map/MobileFilterSheet";
import FiltersPanel from "../components/map/FiltersPanel";
import { useStats } from "../hooks/useStats";
import { Skeleton } from "../components/ui/Skeleton";
import DashboardModeToggle from "../components/stats/DashboardModeToggle";
import DataFreshnessBanner from "../components/stats/DataFreshnessBanner";
import PresetPicker from "../components/stats/PresetPicker";
import DashboardGrid from "../components/stats/DashboardGrid";
import InsightBanner from "../components/stats/InsightBanner";
import { useDashboardConfig } from "../hooks/useDashboardConfig";
import { useDashboardData } from "../hooks/useDashboardData";
import { useCorrelationData } from "../hooks/useCorrelationData";
import { useDashboardKeyboard } from "../hooks/useDashboardKeyboard";
import CorrelationMatrix from "../components/charts/CorrelationMatrix";
import VehicleTrends from "../components/stats/VehicleTrends";
import { encodeDashboard } from "../lib/dashboard/urlCodec";
import SavedDashboardsPanel from "../components/stats/SavedDashboardsPanel";
import NlqQueryBar from "../components/stats/NlqQueryBar";
import MetaTags, { buildOgImageUrl } from "../components/seo/MetaTags";
import { buildDatasetSchema, buildBreadcrumbSchema } from "../components/seo/JsonLd";
import SharePanel, { buildShareUrl } from "../components/seo/SharePanel";
import AnomalyPanel from "../components/stats/AnomalyPanel";
import NarrativePanel from "../components/stats/NarrativePanel";
import SuggestedCharts from "../components/stats/SuggestedCharts";
import { detectAllAnomalies } from "../lib/dashboard/anomaly";
import { useNarrativeInsights } from "../hooks/useNarrativeInsights";
import { useChartSuggestions } from "../hooks/useChartSuggestions";
import PrintHeader from "../components/stats/PrintHeader";
import PrintFooter from "../components/stats/PrintFooter";
import Sparkline from "../components/charts/Sparkline";
import { useTimelapsePlayer } from "../hooks/useTimelapsePlayer";
import { useThrottledValue } from "../hooks/useDebouncedValue";
import TimelapseControls from "../components/stats/TimelapseControls";
import StoryReader from "../components/stats/StoryReader";
import { useDrillDown } from "../hooks/useDrillDown";
import DrillBreadcrumb from "../components/stats/DrillBreadcrumb";
import { DIMENSION_LABELS } from "../lib/dashboard/types";
import { DATA_STORIES, getStoryById } from "../lib/dashboard/stories";
import { useCrossFilter } from "../hooks/useCrossFilter";

export default function StatsPage() {
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [timelapseActive, setTimelapseActive] = useState(false);
  const [storiesMode, setStoriesMode] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);
  const filters = useFilterParams();
  const { drillState, drillToCounty, drillUp, resetDrill } = useDrillDown();
  const crossFilter = useCrossFilter();

  // Time-lapse player
  const tlMinYear = YEARS[0];
  const tlMaxYear = YEARS[YEARS.length - 1] - 1; // Exclude current (incomplete) year
  const timelapse = useTimelapsePlayer(tlMinYear, tlMaxYear);

  // Throttle the timelapse year to avoid overwhelming the API with requests
  // during rapid animation. The visual year display stays responsive (uses
  // timelapse.currentYear directly), but API calls fire at most once per 2s.
  // This lets charts update periodically during playback without flooding
  // the backend (which returns 429 under rapid-fire requests).
  const throttledTlYear = useThrottledValue(timelapse.currentYear, 2000);

  // When timelapse is active, override the date filter to the animated year
  // When drill_county is set, override the county filter to just that county
  const statsFilters = useMemo(() => {
    const baseRange = timelapseActive
      ? { start: { year: throttledTlYear, month: 1 }, end: { year: throttledTlYear, month: 12 } }
      : filters.selectedDateRange;
    const baseCounties = [...filters.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-"));
    const drillCountySlug = drillState.county
      ? drillState.county.toLowerCase().replace(/ /g, "-")
      : null;
    return {
      dateRange: baseRange,
      severities: [...filters.selectedSeverities],
      causes: [...filters.selectedCauses],
      counties: drillCountySlug ? [drillCountySlug] : baseCounties,
      alcohol: filters.selectedAlcohol,
      pedestrian: filters.selectedPedestrian,
      cyclist: filters.selectedCyclist,
      drug: filters.selectedDrug,
      distracted: filters.selectedDistracted,
    };
  }, [timelapseActive, throttledTlYear, filters.selectedDateRange, filters.selectedSeverities, filters.selectedCauses, filters.selectedCounties, filters.selectedAlcohol, filters.selectedPedestrian, filters.selectedCyclist, filters.selectedDrug, filters.selectedDistracted, drillState.county]);
  const { data, loading, error } = useStats(statsFilters);
  const dashboard = useDashboardConfig();
  const crossFilterOverrides = useMemo(() => crossFilter.toFilterOverrides(), [crossFilter.toFilterOverrides]);
  const { dataBySlot, loading: dashLoading, error: dashError, refetch: dashRefetch } = useDashboardData(dashboard.activeCharts, statsFilters, crossFilterOverrides);
  const anomalyResult = useMemo(() => {
    if (dashLoading || Object.keys(dataBySlot).length === 0) return { byChart: {}, all: [] };
    return detectAllAnomalies(dataBySlot, dashboard.activeCharts);
  }, [dataBySlot, dashboard.activeCharts, dashLoading]);
  const { narrative, getChartNarrative, tone, setTone } = useNarrativeInsights({
    dataBySlot,
    charts: dashboard.activeCharts,
    anomalies: anomalyResult.all,
    filters: statsFilters,
    enabled: !dashLoading,
  });
  const suggestions = useChartSuggestions({
    activeCharts: dashboard.activeCharts,
    dataBySlot,
    filters: statsFilters,
    anomalies: anomalyResult.all,
    enabled: !dashLoading,
  });
  const correlation = useCorrelationData();
  const dateRange  = filters.selectedDateRange;
  const severities = filters.selectedSeverities;
  const counties   = filters.selectedCounties;
  const causes     = filters.selectedCauses;

  // Geo drill-down: click county bar → filter to that county
  const handleBarClick = useCallback((label: string, dimension: string) => {
    if (dimension === "county") {
      const slug = label.toLowerCase().replace(/ /g, "-");
      drillToCounty(slug);
    }
  }, [drillToCounty]);

  // Keyboard shortcut: close config panel trigger (incremented to signal DashboardGrid)
  const [closeConfigTrigger, setCloseConfigTrigger] = useState(0);
  const handleCloseConfig = useCallback(() => setCloseConfigTrigger((n) => n + 1), []);

  // Dashboard keyboard shortcuts: 1-8 presets, B for builder, Escape to close config
  useDashboardKeyboard({
    onSetMode: dashboard.setMode,
    onSetPreset: dashboard.setPreset,
    onCloseConfig: handleCloseConfig,
  });

  // Clear drill state and cross-filter when preset changes
  const handlePresetSelect = useCallback((key: Parameters<typeof dashboard.setPreset>[0]) => {
    resetDrill();
    crossFilter.clearCrossFilter();
    dashboard.setPreset(key);
  }, [resetDrill, crossFilter, dashboard]);

  function handleClearAll() {
    filters.clearFilters();
    resetDrill();
    crossFilter.clearCrossFilter();
    setResetKey((k) => k + 1);
  }

  const [printPreview, setPrintPreview] = useState(false);

  useEffect(() => {
    if (printPreview) {
      document.body.classList.add("print-mode");
    } else {
      document.body.classList.remove("print-mode");
    }
    return () => document.body.classList.remove("print-mode");
  }, [printPreview]);

  function handlePrint() {
    window.print();
  }

  // Build typed chips so each one knows how to remove itself.
  // "All X" chips open the filter panel instead of removing — they have no onRemove.
  type Chip = { label: string; onRemove?: () => void; onOpen?: () => void; variant?: "default" | "tertiary" };

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

  const crossFilterChips: Chip[] = crossFilter.state.selection
    ? [{ label: `Cross-filter: ${DIMENSION_LABELS[crossFilter.state.selection.dimension]}`, onRemove: () => crossFilter.clearCrossFilter(), variant: "tertiary" }]
    : [];

  const chips: Chip[] = [
    ...countyChips,
    ...yearChips,
    ...causeChips,
    ...severityChips,
    ...involvementChips,
    ...crossFilterChips,
  ];

  const heroMetrics = data?.heroMetrics ?? {};
  const { totalIncidents, incidentYoYPct, ksiRatePer100k, yoyFatalityChangePct } = heroMetrics;
  const incidentUp = incidentYoYPct != null && incidentYoYPct >= 0;
  const fatalityUp = yoyFatalityChangePct != null && yoyFatalityChangePct > 0;

  // Sparkline data: last 10 years of trends for hero metric cards
  const sparkIncidents = useMemo(() => {
    const yearly = data?.yearlyData ?? [];
    return yearly.slice(-10).map((d) => d.count);
  }, [data?.yearlyData]);
  const sparkFatalities = useMemo(() => {
    const yearly = data?.yearlyData ?? [];
    return yearly.slice(-10).map((d) => d.killed);
  }, [data?.yearlyData]);
  const sparkKsi = useMemo(() => {
    const yearly = data?.yearlyData ?? [];
    return yearly.slice(-10).map((d) => d.killed + d.injured);
  }, [data?.yearlyData]);

  // SEO: dynamic meta tags and OG image based on current dashboard state
  const ogImage = useMemo(() => buildOgImageUrl({
    preset: dashboard.config.preset,
    counties: [...counties].map(c => c.toLowerCase().replace(/ /g, "-")),
    metric: totalIncidents != null ? totalIncidents.toLocaleString() : undefined,
    metricLabel: "Total Incidents",
    trend: incidentYoYPct != null ? (incidentYoYPct >= 0 ? "up" : "down") : undefined,
  }), [dashboard.config.preset, counties, totalIncidents, incidentYoYPct]);

  const seoDescription = useMemo(() => {
    const parts = ["California crash statistics"];
    if (counties.size > 0 && counties.size <= 3) {
      parts.push(`for ${[...counties].join(", ")}`);
    }
    if (totalIncidents != null) {
      parts.push(`— ${totalIncidents.toLocaleString()} incidents`);
    }
    parts.push(". Explore trends, demographics, and safety metrics on CalSight.");
    return parts.join(" ");
  }, [counties, totalIncidents]);

  const jsonLd = useMemo(() => ({
    "@context": "https://schema.org",
    "@graph": [
      buildDatasetSchema({
        counties: counties.size > 0 ? [...counties] : undefined,
        dateRange: dateRange ? {
          start: dateRange.start ? `${dateRange.start.year}-${String(dateRange.start.month).padStart(2, "0")}` : undefined,
          end: dateRange.end ? `${dateRange.end.year}-${String(dateRange.end.month).padStart(2, "0")}` : undefined,
        } : undefined,
      }),
      buildBreadcrumbSchema([
        { name: "Home", path: "/" },
        { name: "Statistics", path: "/stats" },
      ]),
    ],
  }), [counties, dateRange]);

  const fullShareUrl = useMemo(() => {
    const encoded = encodeDashboard(dashboard.config);
    return buildShareUrl({ dashboardEncoded: encoded });
  }, [dashboard.config]);

  // Build print filter summary
  const printFilters = useMemo(() => ({
    counties: [...counties].sort(),
    dateRange: dateRangeLabel,
    severities: severities.size > 0 && severities.size < SEVERITIES.length
      ? [...severities]
      : [],
    causes: causes.size > 0 && causes.size < CAUSE_OPTIONS.length
      ? [...causes].map((c) => CAUSE_LABEL[c] ?? c)
      : [],
    involvements: [
      ...(filters.selectedAlcohol ? ["Alcohol"] : []),
      ...(filters.selectedDistracted ? ["Distracted"] : []),
      ...(filters.selectedPedestrian ? ["Pedestrian"] : []),
      ...(filters.selectedCyclist ? ["Cyclist"] : []),
      ...(filters.selectedDrug ? ["Drug"] : []),
    ],
  }), [counties, dateRangeLabel, severities, causes, filters.selectedAlcohol, filters.selectedDistracted, filters.selectedPedestrian, filters.selectedCyclist, filters.selectedDrug]);

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8 relative print-main">
      <PrintHeader filters={printFilters} />
      <MetaTags
        title={`Statistics Dashboard — CalSight`}
        description={seoDescription}
        ogImage={ogImage}
        path="/stats"
        jsonLd={jsonLd}
        twitterCard="summary_large_image"
      />
      <h1 className="sr-only">Statistics Dashboard</h1>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading ? "Loading statistics..." : error ? "Error loading statistics." : "Statistics loaded."}
      </div>
      {/* Filter Summary Bar */}
      <section className="bg-surface-container-low rounded-lg px-4 md:px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 md:gap-0">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar w-full md:w-auto min-w-0">
          <span className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest mr-2 flex-shrink-0">
            Filters:
          </span>
          <div className="flex items-center gap-2">
            {chips.map((chip) => (
              chip.onRemove ? (
                <span
                  key={chip.label}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                    chip.variant === "tertiary"
                      ? "bg-tertiary/15 text-tertiary border border-tertiary/30"
                      : "bg-surface-container-highest text-on-surface"
                  }`}
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
      <section aria-label="Key metrics summary" className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* Total Incidents */}
        <div className="bg-surface-container-lowest rounded-xl p-5 sm:p-6 ambient-shadow">
          <div className="flex items-start justify-between mb-4">
            <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest">
              Total Incidents
            </p>
            {!loading && sparkIncidents.length >= 2 && (
              <Sparkline data={sparkIncidents} label="Incident trend, last 10 years" />
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            {loading ? (
              <Skeleton className="h-10 w-40" />
            ) : (
              <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tight">
                {totalIncidents != null ? totalIncidents.toLocaleString() : "—"}
              </h2>
            )}
            {incidentYoYPct != null && (
              <span className={`text-sm font-bold flex items-center ${incidentUp ? "text-error" : "text-primary"}`}>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
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
        <div className="bg-surface-container-lowest rounded-xl p-5 sm:p-6 ambient-shadow">
          <div className="flex items-start justify-between mb-4">
            <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest leading-tight">
              KSI Rate / 100K Pop.
            </p>
            {!loading && sparkKsi.length >= 2 && (
              <Sparkline data={sparkKsi} label="KSI trend, last 10 years" />
            )}
          </div>
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
        <div className="bg-surface-container-lowest rounded-xl p-5 sm:p-6 ambient-shadow">
          <div className="flex items-start justify-between mb-4">
            <p className="text-on-surface-variant text-xs font-semibold uppercase tracking-widest">
              YoY Fatality Change
            </p>
            {!loading && sparkFatalities.length >= 2 && (
              <Sparkline data={sparkFatalities} label="Fatality trend, last 10 years" />
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
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
              <span className={`text-sm font-bold flex items-center gap-0.5 ${fatalityUp ? "text-error" : "text-primary"}`}>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  {fatalityUp ? "trending_up" : "trending_down"}
                </span>
                <span className="text-xs">{fatalityUp ? "worse" : "improved"}</span>
              </span>
            )}
          </div>
          <p className="text-on-surface-variant text-[10px] mt-2 italic">
            Change in fatalities vs. prior year
          </p>
        </div>
      </section>

      {/* Auto-generated Insight Banner */}
      <InsightBanner heroMetrics={heroMetrics} loading={loading} />

      {!dashLoading && anomalyResult.all.length > 0 && (
        <AnomalyPanel anomalies={anomalyResult.all} defaultCollapsed />
      )}

      {narrative && (
        <NarrativePanel narrative={narrative} tone={tone} onToneChange={setTone} defaultCollapsed />
      )}

      {!dashLoading && suggestions.length > 0 && (
        <SuggestedCharts
          suggestions={suggestions}
          onAdd={(cfg) => {
            if (dashboard.config.mode === "simple") dashboard.setMode("advanced");
            dashboard.addChart(cfg);
          }}
          defaultCollapsed
        />
      )}

      {/* Dashboard Builder */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap md:flex-nowrap">
          <DashboardModeToggle
            mode={storiesMode ? "stories" : dashboard.config.mode}
            onChange={(m) => {
              if (m === "stories") {
                setStoriesMode(true);
              } else {
                setStoriesMode(false);
                setActiveStoryId(null);
                dashboard.setMode(m);
              }
            }}
          />
          <div className="flex items-center gap-1 sm:gap-2 lg:gap-3 flex-shrink-0 flex-wrap md:flex-nowrap">
            <SavedDashboardsPanel
              currentConfig={dashboard.config}
              onLoad={dashboard.setConfig}
            />
            <SharePanel
              shareUrl={fullShareUrl}
              shareText={`California crash statistics dashboard on CalSight${counties.size > 0 && counties.size <= 3 ? ` — ${[...counties].join(", ")}` : ""}`}
            />
            <button
              type="button"
              onClick={() => {
                setTimelapseActive((v) => {
                  if (v) timelapse.pause();
                  return !v;
                });
              }}
              className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                timelapseActive
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              aria-label="Toggle time-lapse mode"
              aria-pressed={timelapseActive}
            >
              <span className="material-symbols-outlined text-[16px]">
                {timelapseActive ? "stop" : "play_arrow"}
              </span>
              Time-Lapse
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="hidden sm:inline-flex print-keep items-center gap-1 text-on-surface-variant text-[11px] font-medium uppercase tracking-wider hover:text-on-surface transition-colors"
              data-print-hide
              aria-label="Print dashboard"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              Print
            </button>
            <button
              type="button"
              onClick={() => setPrintPreview((v) => !v)}
              className="hidden sm:inline-flex print-keep items-center gap-1 text-on-surface-variant text-[11px] font-medium uppercase tracking-wider hover:text-on-surface transition-colors"
              data-print-hide
              aria-label="Toggle print preview"
            >
              <span className="material-symbols-outlined text-[16px]">
                {printPreview ? "visibility_off" : "visibility"}
              </span>
              {printPreview ? "Exit Preview" : "Preview"}
            </button>
            <DataFreshnessBanner />
          </div>
        </div>
        {storiesMode ? (
          activeStoryId ? (
            <StoryReader
              story={getStoryById(activeStoryId)!}
              onBack={() => setActiveStoryId(null)}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {DATA_STORIES.map((story) => (
                <button
                  key={story.id}
                  type="button"
                  onClick={() => setActiveStoryId(story.id)}
                  className="text-left bg-surface-container-lowest rounded-xl p-5 ambient-shadow hover:bg-surface-container-low transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">
                      {story.icon}
                    </span>
                    <h3 className="text-sm font-headline font-bold text-on-surface group-hover:text-primary transition-colors">
                      {story.title}
                    </h3>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    {story.subtitle}
                  </p>
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            {timelapseActive && (
              <TimelapseControls
                currentYear={timelapse.currentYear}
                isPlaying={timelapse.isPlaying}
                speed={timelapse.speed}
                minYear={tlMinYear}
                maxYear={tlMaxYear}
                onPlay={timelapse.play}
                onPause={timelapse.pause}
                onSeek={timelapse.seek}
                onSetSpeed={timelapse.setSpeed}
              />
            )}
            <NlqQueryBar onAddChart={(cfg) => {
              if (dashboard.config.mode === "simple") dashboard.setMode("advanced");
              dashboard.addChart(cfg);
            }} />
            {dashboard.config.mode === "simple" && (
              <PresetPicker active={dashboard.config.preset} onSelect={handlePresetSelect} />
            )}
            {dashError && (
              <div role="alert" className="flex items-center gap-3 bg-error-container/30 rounded-lg px-4 py-3">
                <span className="material-symbols-outlined text-[20px] text-error" aria-hidden="true">cloud_off</span>
                <div className="flex-1">
                  <p className="text-error text-sm font-semibold">Unable to load chart data</p>
                  <p className="text-on-surface-variant text-xs mt-0.5">The server may be temporarily unavailable. You can retry or adjust your filters.</p>
                </div>
                <button
                  type="button"
                  onClick={() => dashRefetch()}
                  className="px-4 py-2 bg-primary text-on-primary rounded-full text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  Retry
                </button>
              </div>
            )}
            <DrillBreadcrumb drillState={drillState} onDrillUp={drillUp} />
            <DashboardGrid
              charts={dashboard.activeCharts}
              dataBySlot={dataBySlot}
              mode={dashboard.config.mode}
              loading={dashLoading}
              onAddChart={dashboard.addChart}
              onRemoveChart={dashboard.removeChart}
              onUpdateChart={dashboard.updateChart}
              onMoveChart={dashboard.moveChart}
              onReorderChart={dashboard.reorderChart}
              closeConfigTrigger={closeConfigTrigger}
              getChartNarrative={getChartNarrative}
              crossFilter={crossFilter}
              onBarClick={handleBarClick}
            />
          </>
        )}
      </section>

      {/* Vehicle Trends */}
      <section className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 md:p-8 ambient-shadow overflow-hidden">
        <VehicleTrends />
      </section>

      {/* Correlation Explorer — hidden in Stories mode */}
      {!storiesMode && <section className="bg-surface-container-lowest rounded-2xl p-3 sm:p-5 md:p-8 ambient-shadow overflow-hidden">
        {correlation.isLoading ? (
          <Skeleton className="h-[500px] rounded-lg" />
        ) : correlation.error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl" aria-hidden="true">cloud_off</span>
            <p className="text-sm">Correlation data unavailable — backend may be offline</p>
          </div>
        ) : correlation.data ? (
          <CorrelationMatrix
            fields={correlation.data.fields}
            matrix={correlation.data.matrix}
            countyCount={correlation.data.countyCount}
            counties={correlation.data.counties}
          />
        ) : null}
      </section>}

      {/* Methodology Footer */}
      <section className="border-t border-outline-variant/15 pt-8 sm:pt-12 pb-10 sm:pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-12 text-[11px] leading-relaxed uppercase tracking-wider font-medium text-on-surface-variant">
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-xs">Data Sources</h4>
            <p>
              Crash records from the Statewide Integrated Traffic Records
              System (SWITRS, 2001&ndash;2015) and the California Crash Records
              System (CCRS, 2016&ndash;present), maintained by the California
              Highway Patrol. Demographics from U.S. Census ACS 5-year
              estimates. Environmental data from CalEnviroScreen 4.0 (OEHHA).
              Employment from Bureau of Labor Statistics LAUS. Vehicle and
              driver data from California DMV.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-xs">California Public Records Act</h4>
            <p>
              SWITRS and CCRS data are public records under CA Gov Code
              &sect; 6250. Source data available at data.chp.ca.gov. This
              dashboard is an independent analysis and is not affiliated
              with or endorsed by the California Highway Patrol, Caltrans,
              or any state agency.
            </p>
          </div>
        </div>
      </section>

      <PrintFooter />

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
    </div>
  );
}
