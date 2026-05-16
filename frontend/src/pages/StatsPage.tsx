import { useState, useEffect, useMemo, useCallback } from "react";
import { useFilterParams, formatYearMonth, CAUSES as CAUSE_OPTIONS, SEVERITIES } from "../hooks/useFilterParams";
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

export default function StatsPage() {
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const filters = useFilterParams();
  const statsFilters = useMemo(() => ({
    dateRange: filters.selectedDateRange,
    severities: [...filters.selectedSeverities],
    causes: [...filters.selectedCauses],
    counties: [...filters.selectedCounties].map((c) => c.toLowerCase().replace(/ /g, "-")),
    alcohol: filters.selectedAlcohol,
    pedestrian: filters.selectedPedestrian,
    cyclist: filters.selectedCyclist,
    drug: filters.selectedDrug,
    distracted: filters.selectedDistracted,
  }), [filters.selectedDateRange, filters.selectedSeverities, filters.selectedCauses, filters.selectedCounties, filters.selectedAlcohol, filters.selectedPedestrian, filters.selectedCyclist, filters.selectedDrug, filters.selectedDistracted]);
  const { data, loading, error } = useStats(statsFilters);
  const dashboard = useDashboardConfig();
  const { dataBySlot, loading: dashLoading, error: dashError } = useDashboardData(dashboard.activeCharts, statsFilters);
  const correlation = useCorrelationData();
  const dateRange  = filters.selectedDateRange;
  const severities = filters.selectedSeverities;
  const counties   = filters.selectedCounties;
  const causes     = filters.selectedCauses;

  // Keyboard shortcut: close config panel trigger (incremented to signal DashboardGrid)
  const [closeConfigTrigger, setCloseConfigTrigger] = useState(0);
  const handleCloseConfig = useCallback(() => setCloseConfigTrigger((n) => n + 1), []);

  // Dashboard keyboard shortcuts: 1-8 presets, B for builder, Escape to close config
  useDashboardKeyboard({
    onSetMode: dashboard.setMode,
    onSetPreset: dashboard.setPreset,
    onCloseConfig: handleCloseConfig,
  });

  function handleClearAll() {
    filters.clearFilters();
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

  const heroMetrics = data?.heroMetrics ?? {};
  const { totalIncidents, incidentYoYPct, ksiRatePer100k, yoyFatalityChangePct } = heroMetrics;
  const incidentUp = incidentYoYPct != null && incidentYoYPct >= 0;
  const fatalityUp = yoyFatalityChangePct != null && yoyFatalityChangePct > 0;

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
        dateRange: dateRange ? { start: dateRange.start, end: dateRange.end } : undefined,
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

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8 relative">
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
              <span className={`text-sm font-bold flex items-center ${fatalityUp ? "text-error" : "text-primary"}`}>
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
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

      {/* Auto-generated Insight Banner */}
      <InsightBanner heroMetrics={heroMetrics} loading={loading} />

      {/* Dashboard Builder */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <DashboardModeToggle mode={dashboard.config.mode} onChange={dashboard.setMode} />
          <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
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
        <NlqQueryBar onAddChart={(cfg) => {
          if (dashboard.config.mode === "simple") dashboard.setMode("advanced");
          dashboard.addChart(cfg);
        }} />
        {dashboard.config.mode === "simple" && (
          <PresetPicker active={dashboard.config.preset} onSelect={dashboard.setPreset} />
        )}
        {dashError && (
          <p role="alert" className="text-error text-sm flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">warning</span>
            Failed to load chart data. Try adjusting your filters.
          </p>
        )}
        {dashLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: dashboard.activeCharts.length || 4 }).map((_, i) => (
              <div key={i} className="bg-surface-container-lowest rounded-2xl p-4 ambient-shadow">
                <Skeleton className="h-48 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <DashboardGrid
            charts={dashboard.activeCharts}
            dataBySlot={dataBySlot}
            mode={dashboard.config.mode}
            onAddChart={dashboard.addChart}
            onRemoveChart={dashboard.removeChart}
            onUpdateChart={dashboard.updateChart}
            onMoveChart={dashboard.moveChart}
            closeConfigTrigger={closeConfigTrigger}
          />
        )}
      </section>

      {/* Vehicle Trends */}
      <section className="bg-surface-container-lowest rounded-2xl p-5 md:p-8 ambient-shadow">
        <VehicleTrends />
      </section>

      {/* Correlation Explorer */}
      <section className="bg-surface-container-lowest rounded-2xl p-5 md:p-8 ambient-shadow overflow-hidden">
        {correlation.isLoading ? (
          <Skeleton className="h-[500px] rounded-lg" />
        ) : correlation.error ? (
          <p className="text-error text-sm">Failed to load correlation data.</p>
        ) : correlation.data ? (
          <CorrelationMatrix
            fields={correlation.data.fields}
            matrix={correlation.data.matrix}
            countyCount={correlation.data.countyCount}
            counties={correlation.data.counties}
          />
        ) : null}
      </section>

      {/* Methodology Footer */}
      <section className="border-t border-outline-variant/15 pt-12 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-[10px] leading-relaxed uppercase tracking-widest font-medium text-on-surface-variant">
          <div className="space-y-4">
            <h4 className="font-bold text-on-surface text-[11px]">Data Sources</h4>
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
            <h4 className="font-bold text-on-surface text-[11px]">California Public Records Act</h4>
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
