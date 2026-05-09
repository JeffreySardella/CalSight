import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useQueryClient } from "@tanstack/react-query";
import { useFilterParams, CA_COUNTIES } from "../hooks/useFilterParams";
import type { CoordCoverage } from "../hooks/useCoordCoverage";
import { useMapKeyboard } from "../hooks/useMapKeyboard";
import { LayersStateProvider, useLayersState } from "../hooks/useLayersState";
import ChoroplethLegend from "../components/map/ChoroplethLegend";
import { useChoroplethData, type ChoroplethData } from "../hooks/useChoroplethData";
import { MEASURES } from "../lib/choropleth/measures";
import KeyboardHelpModal from "../components/map/KeyboardHelpModal";
import IconRail from "../components/map/IconRail";
import SidePanel from "../components/map/SidePanel";
import FiltersPanel, {
  FiltersPanelFooter,
} from "../components/map/FiltersPanel";
import LayersPanel, {
  LayersPanelFooter,
} from "../components/map/LayersPanel";
import DataExportPanel, {
  DataExportPanelFooter,
} from "../components/map/DataExportPanel";
import MapCanvas from "../components/map/MapCanvas";
import AiInsightCard from "../components/map/AiInsightCard";
import Breadcrumb from "../components/map/Breadcrumb";
import StatewideHeatmapCard from "../components/map/StatewideHeatmapCard";
import { EmptyState } from "../components/ui/EmptyState";
import { useCrashHeatmap, useBatchedHeatmap } from "../hooks/useCrashHeatmap";
import MobileFilterSheet from "../components/map/MobileFilterSheet";
import { useCoordCoverage } from "../hooks/useCoordCoverage";
import { useCountyInsight } from "../hooks/useCountyInsight";
import { useRandomInsight } from "../hooks/useRandomInsight";
import StatewideInsightCard from "../components/map/StatewideInsightCard";

const PANEL_META: Record<string, { title: string; subtitle: string }> = {
  filters: { title: "Filters", subtitle: "Secondary Parameters" },
  layers: { title: "Layers", subtitle: "Map Configuration" },
  export: { title: "Data Export", subtitle: "Export Explorer" },
};

const VALID_PANELS = new Set(Object.keys(PANEL_META));

function HeatmapLoadingPill() {
  const [showSlow, setShowSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowSlow(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
      <div className="bg-surface-container-lowest/95 backdrop-blur-md px-4 py-2 rounded-full ghost-border shadow-lg flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-medium text-on-surface-variant">Loading crash data...</span>
        </div>
        {showSlow && (
          <span className="text-[10px] text-on-surface-variant/70">Large county — this may take a moment</span>
        )}
      </div>
    </div>
  );
}

function MapPageInner() {
  const {
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
    panel: panelParam,
    clearPanel,
  } = useFilterParams();

  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [showInsight, setShowInsight] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [mobileSearchExpanded, setMobileSearchExpanded] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [focusedCounty, setFocusedCounty] = useState<string | null>(null);
  const [compareCounty, setCompareCounty] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [insightCounty, setInsightCounty] = useState("Fresno");
  const mapRef = useRef<LeafletMap | null>(null);

  const countyNames = CA_COUNTIES.map((c) => String(c)).sort();

  const { measure, otherLayers, heatmapResolution, palette, choroplethOn } = useLayersState();

  const useCountyDetail = !!focusedCounty && otherLayers.heatmapCounty && (!compareMode || !!compareCounty);

  const heatmapCountySlugs = useCountyDetail ? (() => {
    const slugs: string[] = [];
    if (focusedCounty) slugs.push(focusedCounty.toLowerCase().replace(/\s+/g, "-"));
    if (compareCounty) slugs.push(compareCounty.toLowerCase().replace(/\s+/g, "-"));
    return slugs.join(",") || null;
  })() : null;

  const effectiveResolution = useCountyDetail
    ? "raw" as const
    : (heatmapResolution === "high" || heatmapResolution === "raw" ? "low" : heatmapResolution);

  const heatmapEnabled = useCountyDetail || otherLayers.heatmapStatewide;

  const involvementFilters = {
    alcohol: selectedAlcohol || undefined,
    distracted: selectedDistracted || undefined,
    pedestrian: selectedPedestrian || undefined,
    cyclist: selectedCyclist || undefined,
    drug: selectedDrug || undefined,
    driverAge: selectedDriverAge ?? undefined,
  };

  const statewideHeatmap = useCrashHeatmap({
    enabled: heatmapEnabled && !useCountyDetail,
    county: null,
    dateRange: selectedDateRange,
    severities: [...selectedSeverities],
    causes: [...selectedCauses],
    ...involvementFilters,
    resolution: effectiveResolution,
  });

  const countyHeatmap = useBatchedHeatmap({
    enabled: heatmapEnabled && useCountyDetail,
    county: heatmapCountySlugs,
    dateRange: selectedDateRange,
    severities: [...selectedSeverities],
    causes: [...selectedCauses],
    ...involvementFilters,
    resolution: "raw",
  });

  const heatmap = useCountyDetail
    ? { points: countyHeatmap.points, totalCrashes: countyHeatmap.totalCrashes, isLoading: countyHeatmap.isLoading, error: countyHeatmap.error }
    : statewideHeatmap;

  const mismatchCountySlug = focusedCounty ? focusedCounty.toLowerCase().replace(/\s+/g, "-") : null;
  const mismatchHeatmap = useCrashHeatmap({
    enabled: otherLayers.coordMismatches && !!mismatchCountySlug,
    county: mismatchCountySlug,
    dateRange: selectedDateRange,
    severities: [...selectedSeverities],
    causes: [...selectedCauses],
    ...involvementFilters,
    resolution: "raw",
    mismatchOnly: true,
    includeRivers: otherLayers.coordIncludeRivers,
  });

  const coordCoverage = useCoordCoverage(selectedDateRange);
  const choroplethFilters = useMemo(
    () => ({
      dateRange: selectedDateRange,
      severities: [...selectedSeverities],
      causes: [...selectedCauses],
    }),
    [selectedDateRange, selectedSeverities, selectedCauses],
  );
  const choroplethData = useChoroplethData(measure, choroplethFilters);

  const inspectedCode = focusedCounty ? choroplethData.nameToCode[focusedCounty] : undefined;
  const inspectedData = inspectedCode != null ? choroplethData.byCountyCode[inspectedCode] : undefined;
  const compareCode = compareCounty ? choroplethData.nameToCode[compareCounty] : undefined;
  const comparePointData = compareCode != null ? choroplethData.byCountyCode[compareCode] : undefined;
  const measureLabel = MEASURES[measure].label;

  // When exactly one year is selected, pass it to the insight API so the
  // narrative matches the active filter context. Otherwise use the API
  // default (latest available year).
  const insightYear = selectedYears.size === 1 ? [...selectedYears][0] : undefined;
  // Gate on focusedCounty so we never fire before a county is actually clicked.
  // insightCounty can lag behind by one render (it's preserved after deselect
  // so the closing animation has a name to show), so use focusedCounty as the
  // real enable gate.
  const { data: insightData } = useCountyInsight(
    focusedCounty ? insightCounty : null,
    insightYear,
  );

  const {
    card: randomCard,
    refresh: refreshRandomCard,
  } = useRandomInsight(
    focusedCounty ? insightCounty : null,
    insightYear,
  );

  const handleMapReady = useCallback((map: LeafletMap) => {
    mapRef.current = map;
  }, []);

  const selectingRef = useRef(false);

  const handleSelectCounty = useCallback((name: string) => {
    if (selectingRef.current) return;
    selectingRef.current = true;

    if (compareMode && name !== focusedCounty) {
      setCompareCounty(name);
      toggleCounty(name);
      selectingRef.current = false;
    } else {
      setFocusedCounty(name);
      setInsightCounty(name);
      setShowInsight(true);
      setCompareCounty(null);
      setCompareMode(false);
      setCounty(name);
      setTimeout(() => { selectingRef.current = false; }, 300);
    }
  }, [compareMode, focusedCounty, setCounty, toggleCounty]);

  const handleDeselect = useCallback(() => {
    setFocusedCounty(null);
    setCompareCounty(null);
    setCompareMode(false);
    setShowInsight(false);
    clearCounties();
  }, [clearCounties]);

  const handleStartCompare = useCallback(() => {
    setCompareMode(true);
    mapRef.current?.flyTo([37.2, -119.5], 6, { duration: 0.8 });
  }, []);

  const handleFocusCounty = useCallback((name: string | null) => {
    if (compareMode && name !== null) return;
    setFocusedCounty(name);
    if (name === null) {
      setCompareCounty(null);
      setCompareMode(false);
      setShowInsight(false);
      clearCounties();
    }
  }, [compareMode, clearCounties]);

  function handleClearAll() {
    clearFilters();
    setResetKey((k) => k + 1);
  }

  const handleCloseOverlay = useCallback(() => {
    if (showHelp) {
      setShowHelp(false);
    } else if (showInsight) {
      handleDeselect();
    } else if (activePanel) {
      setActivePanel(null);
    } else if (showMobileFilters) {
      setShowMobileFilters(false);
    }
  }, [showHelp, showInsight, activePanel, showMobileFilters, handleDeselect]);

  useMapKeyboard({
    map: mapRef.current,
    counties: countyNames,
    focusedCounty,
    onFocusCounty: handleFocusCounty,
    onSelectCounty: handleSelectCounty,
    onCloseOverlay: handleCloseOverlay,
    onToggleHelp: () => setShowHelp((prev) => !prev),
  });

  // If URL has ?panel=filters, open that panel then clean the param.
  // replace: true in clearPanel() prevents a back-button loop.
  useEffect(() => {
    if (panelParam && VALID_PANELS.has(panelParam)) {
      setActivePanel(panelParam);
      clearPanel();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle(panel: string) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function handleClose() {
    setActivePanel(null);
  }

  const meta = activePanel ? PANEL_META[activePanel] : null;

  const filtersPanelProps = {
    selectedDateRange,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    selectedAlcohol,
    selectedDistracted,
    selectedPedestrian,
    selectedCyclist,
    selectedDrug,
    selectedDriverAge,
    onSetDateRange: setDateRange,
    onClearDateRange: clearDateRange,
    onToggleSeverity: toggleSeverity,
    onSetSeverities: setSeverities,
    onSetAllSeverities: setAllSeverities,
    onClearSeverities: clearSeverities,
    onToggleCounty: toggleCounty,
    onClearCounties: clearCounties,
    onToggleCause: toggleCause,
    onSetCauses: setCauses,
    onSetAllCauses: setAllCauses,
    onClearCauses: clearCauses,
    onToggleAlcohol: toggleAlcohol,
    onToggleDistracted: toggleDistracted,
    onTogglePedestrian: togglePedestrian,
    onToggleCyclist: toggleCyclist,
    onToggleDrug: toggleDrug,
    onSetDriverAge: setDriverAge,
    resetKey,
  };

  function renderPanelContent() {
    switch (activePanel) {
      case "filters":
        return <FiltersPanel {...filtersPanelProps} />;
      case "layers":
        return <LayersPanel />;
      case "export":
        return <DataExportPanel />;
      default:
        return null;
    }
  }

  function renderPanelFooter() {
    switch (activePanel) {
      case "filters":
        return <FiltersPanelFooter onClear={handleClearAll} />;
      case "layers":
        return <LayersPanelFooter />;
      case "export":
        return <DataExportPanelFooter />;
      default:
        return undefined;
    }
  }

  return (
    <>
      {/* Sidebar — hidden on mobile */}
      <div className="hidden md:flex h-full z-40">
        <IconRail activePanel={activePanel} onPanelToggle={handleToggle} />
        <div
          className="transition-all duration-300 overflow-hidden"
          style={{ width: activePanel && meta ? 300 : 0 }}
        >
          {activePanel && meta && (
            <SidePanel
              title={meta.title}
              subtitle={meta.subtitle}
              onClose={handleClose}
              footer={renderPanelFooter()}
            >
              {renderPanelContent()}
            </SidePanel>
          )}
        </div>
      </div>

      {/* Map canvas + floating overlays */}
      <section className="flex-1 relative transition-all duration-300">
        <MapCanvas
          focusedCounty={focusedCounty}
          compareCounty={compareCounty}
          onFocusCounty={handleFocusCounty}
          onSelectCounty={handleSelectCounty}
          onMapReady={handleMapReady}
          heatmapPoints={heatmap.points}
          heatmapActive={heatmapEnabled}
          heatmapResolution={effectiveResolution}
          heatmapPalette={palette}
          countyDrilldown={useCountyDetail}
          mismatchPoints={otherLayers.coordMismatches ? mismatchHeatmap.points : []}
        />

        {/* Mobile: search + filter icon buttons (right), hide when search expanded */}
        {!mobileSearchExpanded && (
          <div className="absolute top-3 right-3 z-20 md:hidden flex items-center gap-2">
            <button
              onClick={() => setMobileSearchExpanded(true)}
              className="flex items-center justify-center w-10 h-10 bg-surface-container-lowest/90 backdrop-blur-md rounded-full shadow-lg ghost-border text-on-surface"
              aria-label="Search"
            >
              <span className="material-symbols-outlined text-[20px]">search</span>
            </button>
            <button
              onClick={() => setShowMobileFilters(true)}
              className="flex items-center justify-center w-10 h-10 bg-surface-container-lowest/90 backdrop-blur-md rounded-full shadow-lg ghost-border text-on-surface"
              aria-label="Open filters"
            >
              <span className="material-symbols-outlined text-[20px]">tune</span>
            </button>
          </div>
        )}
        {mobileSearchExpanded && (
          <MobileSearchPill
            expanded={true}
            onExpand={() => setMobileSearchExpanded(true)}
            onCollapse={() => setMobileSearchExpanded(false)}
            onSelect={(name) => { handleSelectCounty(name); setMobileSearchExpanded(false); }}
            map={mapRef.current}
          />
        )}

        {!choroplethData.isLoading
          && !choroplethData.isError
          && choroplethData.dataSummary.totalCrashes === 0
          && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
            <div className="bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-xl px-6 py-5 ambient-shadow pointer-events-auto max-w-xs">
              <EmptyState
                icon="filter_list_off"
                title="No matching crashes"
                description="Adjust your filters to see data on the map."
              />
            </div>
          </div>
        )}

        {showInsight && focusedCounty && (
          <AiInsightCard
            onClose={handleDeselect}
            countyName={insightCounty}
            data={inspectedData}
            measureLabel={measureLabel}
            compareMode={compareMode}
            onCompare={handleStartCompare}
            compareCountyName={compareCounty ?? undefined}
            compareData={comparePointData}
            narrative={randomCard?.narrative ?? insightData?.narrative}
            narrativeAngle={randomCard?.angle}
            onRefreshNarrative={randomCard ? refreshRandomCard : undefined}
            loading={choroplethData.isLoading}
          />
        )}
        <Breadcrumb
          inspectedCounty={focusedCounty}
          compareCounty={compareCounty}
          onDeselect={handleDeselect}
        />
        <ChoroplethLegendContainer
          choroplethData={choroplethData}
          coordCoverage={coordCoverage}
          heatmapCrashes={heatmapEnabled ? heatmap.totalCrashes : null}
          heatmapDisplayed={heatmapEnabled ? heatmap.points.length : null}
          heatmapLoading={heatmapEnabled && heatmap.isLoading}
          countyActive={!!focusedCounty}
          countyTotalCrashes={inspectedData?.rawCount ?? null}
          searchOpen={mobileSearchExpanded}
          mismatchCount={otherLayers.coordMismatches ? mismatchHeatmap.totalCrashes : null}
        />
        {otherLayers.heatmapStatewide && !focusedCounty && !choroplethOn && (
          <StatewideHeatmapCard
            totalCrashes={statewideHeatmap.totalCrashes}
            displayed={statewideHeatmap.points.length}
            isLoading={statewideHeatmap.isLoading}
            searchOpen={mobileSearchExpanded}
          />
        )}
        {!focusedCounty && randomCard && (
          <StatewideInsightCard
            card={randomCard}
            onRefresh={refreshRandomCard}
            searchOpen={mobileSearchExpanded}
          />
        )}
        {heatmapEnabled && heatmap.isLoading && (
          <HeatmapLoadingPill />
        )}
        {useCountyDetail && !countyHeatmap.isLoading && countyHeatmap.totalBatches && countyHeatmap.totalBatches > 1 && countyHeatmap.hasMore && (
          <div className="absolute top-2 left-2 md:top-2 md:left-16 z-20 md:z-30">
            <div className="bg-surface-container-lowest/90 backdrop-blur-md px-3 py-1.5 rounded-full text-[11px] font-medium ghost-border shadow-lg flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-on-surface-variant">
                Loading batch {countyHeatmap.currentBatch}/{countyHeatmap.totalBatches}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Mobile filter bottom sheet */}
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
              <FiltersPanel {...filtersPanelProps} />
            ),
          },
          {
            key: "layers",
            label: "Layers",
            icon: "layers",
            content: <LayersPanel />,
          },
        ]}
      />

      <KeyboardHelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
      />
    </>
  );
}

export default function MapPage() {
  return (
    <LayersStateProvider>
      <MapPageInner />
    </LayersStateProvider>
  );
}

function ChoroplethLegendContainer({
  choroplethData,
  coordCoverage,
  heatmapCrashes,
  heatmapDisplayed,
  heatmapLoading,
  countyActive,
  countyTotalCrashes,
  searchOpen,
  mismatchCount,
}: {
  choroplethData: ChoroplethData;
  coordCoverage?: CoordCoverage | null;
  heatmapCrashes?: number | null;
  heatmapDisplayed?: number | null;
  heatmapLoading?: boolean;
  countyActive?: boolean;
  countyTotalCrashes?: number | null;
  searchOpen?: boolean;
  mismatchCount?: number | null;
}) {
  const queryClient = useQueryClient();
  return (
    <ChoroplethLegend
      demographicsAvailable={choroplethData.demographicsAvailable}
      dataSummary={choroplethData.dataSummary}
      coordCoverage={coordCoverage}
      isLoading={choroplethData.isLoading}
      isError={choroplethData.isError}
      is422={choroplethData.is422}
      searchOpen={searchOpen}
      onRetry={() => queryClient.invalidateQueries({ queryKey: ["choropleth"] })}
      heatmapCrashes={heatmapCrashes}
      heatmapDisplayed={heatmapDisplayed}
      heatmapLoading={heatmapLoading}
      countyActive={countyActive}
      countyTotalCrashes={countyTotalCrashes}
      mismatchCount={mismatchCount}
    />
  );
}

// ---------------------------------------------------------------------------
// Mobile search pill — inline at top center, expands to show results below
// ---------------------------------------------------------------------------

const MOBILE_COUNTY_NAMES = (CA_COUNTIES as unknown as string[]).slice().sort();

function MobileSearchPill({
  expanded,
  onExpand,
  onCollapse,
  onSelect,
  map,
}: {
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onSelect: (name: string) => void;
  map: LeafletMap | null;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = query.trim()
    ? MOBILE_COUNTY_NAMES.filter((n) =>
        n.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 4)
    : [];

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  // Collapse when map moves
  useEffect(() => {
    if (!map) return;
    const collapse = () => { onCollapse(); setQuery(""); };
    map.on("movestart", collapse);
    return () => { map.off("movestart", collapse); };
  }, [map, onCollapse]);

  // Close on outside tap
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCollapse();
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded, onCollapse]);

  const handleSelect = (name: string) => {
    onSelect(name);
    setQuery("");
  };

  return (
    <div
      ref={containerRef}
      className={expanded
        ? "absolute top-3 left-3 right-3 z-20 md:hidden"
        : "md:hidden"
      }
    >
      <div
        className={`
          flex items-center gap-2
          bg-surface-container-lowest/90 backdrop-blur-md
          ghost-border shadow-lg
          ${expanded ? "h-10 rounded-2xl px-3" : "h-10 rounded-full px-3 cursor-pointer"}
        `}
        onClick={() => !expanded && onExpand()}
      >
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
          search
        </span>
        {expanded ? (
          <>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { onCollapse(); setQuery(""); }
                if (e.key === "Enter" && results.length > 0) handleSelect(results[0]);
              }}
              placeholder="Search counties…"
              className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none border-none min-w-0"
            />
            <button
              onClick={(e) => { e.stopPropagation(); onCollapse(); setQuery(""); }}
              className="p-0.5 rounded-full"
            >
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">close</span>
            </button>
          </>
        ) : (
          <span className="text-[11px] text-on-surface-variant font-medium">Counties</span>
        )}
      </div>

      {expanded && results.length > 0 && (
        <div className="mt-1.5 bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-2xl shadow-lg overflow-hidden">
          {results.map((name) => (
            <button
              key={name}
              onClick={() => handleSelect(name)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-on-surface text-left hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-[14px] text-on-surface-variant">location_on</span>
              <span>{name} County</span>
            </button>
          ))}
        </div>
      )}

      {expanded && query.trim() && results.length === 0 && (
        <div className="mt-1.5 bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-2xl shadow-lg px-3 py-2.5">
          <p className="text-xs text-on-surface-variant">No match for "{query}"</p>
        </div>
      )}
    </div>
  );
}
