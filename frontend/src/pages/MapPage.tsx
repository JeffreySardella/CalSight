import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useQueryClient } from "@tanstack/react-query";
import { useFilterParams, CA_COUNTIES } from "../hooks/useFilterParams";
import { useViewportParams } from "../hooks/useViewportParams";
import { useLayerParams } from "../hooks/useLayerParams";
import type { CoordCoverage } from "../hooks/useCoordCoverage";
import { useMapKeyboard } from "../hooks/useMapKeyboard";
import { LayersStateProvider, useLayersState } from "../hooks/useLayersState";
import ChoroplethLegend from "../components/map/ChoroplethLegend";
import { useChoroplethData, type ChoroplethData } from "../hooks/useChoroplethData";
import { MEASURES } from "../lib/choropleth/measures";
import KeyboardHelpModal from "../components/map/KeyboardHelpModal";
import IconRail from "../components/map/IconRail";
import SidePanel from "../components/map/SidePanel";
import FilterPanelRouter from "../components/map/filters/FilterPanelRouter";
import type { StagedFilters } from "../hooks/useStagedFilters";
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
import ShareButton from "../components/ui/ShareButton";
import { useCrashHeatmap, useBatchedHeatmap } from "../hooks/useCrashHeatmap";
import MobileFilterSheet from "../components/map/MobileFilterSheet";
import { useCoordCoverage } from "../hooks/useCoordCoverage";
import { useCountyInsight } from "../hooks/useCountyInsight";
import { useRandomInsight } from "../hooks/useRandomInsight";
import ActiveFiltersBanner from "../components/map/ActiveFiltersBanner";
import { usePrefetchFacets } from "../hooks/usePrefetchFacets";
import { useCountyGeoJson } from "../hooks/useCountyGeoJson";
import { findCountyAtPoint } from "../lib/geo/pointInCounty";
import UnifiedSearchBar from "../components/map/UnifiedSearchBar";
import FilteredUrlPrompt from "../components/map/FilteredUrlPrompt";
import IntroOverlay from "../components/map/IntroOverlay";

const PANEL_META: Record<string, { title: string; subtitle: string }> = {
  filters: { title: "Filters", subtitle: "Secondary Parameters" },
  layers: { title: "Layers", subtitle: "Map Configuration" },
  export: { title: "Data Export", subtitle: "Export Explorer" },
};

const VALID_PANELS = new Set(Object.keys(PANEL_META));


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
    selectedWeather,
    selectedLighting,
    selectedCollisionType,
    selectedRoadType,
    selectedHitRun,
    toggleCounty,
    setCounty,
    clearCounties,
    clearCauses,
    clearSeverities,
    toggleAlcohol,
    togglePedestrian,
    setDriverAge,
    clearFilters,
    setAllFilters,
    panel: panelParam,
    clearPanel,
  } = useFilterParams();

  // Viewport ↔ URL: initialViewport seeds the camera on mount; writeViewport
  // mirrors pan/zoom back into the URL so a copied link reproduces the view.
  const { initialViewport, writeViewport } = useViewportParams();

  const [activePanel, setActivePanel] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleIntroStart = useCallback((_mode: "simple" | "advanced") => {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      setShowMobileFilters(true);
    } else {
      setActivePanel("filters");
    }
  }, []);
  const [showInsight, setShowInsight] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [focusedCounty, setFocusedCounty] = useState<string | null>(null);
  const [tempMarker, setTempMarker] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [compareCounty, setCompareCounty] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [insightCounty, setInsightCounty] = useState("Fresno");
  const [showStatewide, setShowStatewide] = useState(true);
  const [showFilterPrompt, setShowFilterPrompt] = useState(() => {
    if (sessionStorage.getItem("calsight-filter-prompt-dismissed")) return false;
    const hasFilters = selectedDateRange !== null
      || selectedSeverities.size > 0
      || selectedCauses.size > 0
      || selectedAlcohol || selectedDistracted || selectedPedestrian
      || selectedCyclist || selectedDrug || selectedDriverAge !== null;
    return hasFilters;
  });
  const mapRef = useRef<LeafletMap | null>(null);

  const countyNames = CA_COUNTIES.map((c) => String(c)).sort();
  usePrefetchFacets();
  const { data: countyGeoJson } = useCountyGeoJson();

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
    weather: selectedWeather.size > 0 ? [...selectedWeather] : undefined,
    lighting: selectedLighting.size > 0 ? [...selectedLighting] : undefined,
    collisionType: selectedCollisionType.size > 0 ? [...selectedCollisionType] : undefined,
    roadType: selectedRoadType ?? undefined,
    hitRun: selectedHitRun || undefined,
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
      alcohol: selectedAlcohol || undefined,
      distracted: selectedDistracted || undefined,
      pedestrian: selectedPedestrian || undefined,
      cyclist: selectedCyclist || undefined,
      drug: selectedDrug || undefined,
      driverAge: selectedDriverAge ?? undefined,
      weather: selectedWeather.size > 0 ? [...selectedWeather] : undefined,
      lighting: selectedLighting.size > 0 ? [...selectedLighting] : undefined,
      collisionType: selectedCollisionType.size > 0 ? [...selectedCollisionType] : undefined,
      roadType: selectedRoadType ?? undefined,
      hitRun: selectedHitRun || undefined,
    }),
    [selectedDateRange, selectedSeverities, selectedCauses, selectedAlcohol, selectedDistracted, selectedPedestrian, selectedCyclist, selectedDrug, selectedDriverAge, selectedWeather, selectedLighting, selectedCollisionType, selectedRoadType, selectedHitRun],
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

  // Flush the live viewport into the URL right before a share-link copy, so
  // the link reflects the current camera even if the debounced sync (250ms)
  // hasn't fired yet. setSearchParams updates window.location synchronously.
  const handleShareFlush = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    writeViewport([c.lat, c.lng], map.getZoom());
  }, [writeViewport]);

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

  const handleSelectPlace = useCallback((lat: number, lng: number) => {
    setTempMarker([lat, lng]);
    mapRef.current?.setView([lat, lng], 14, { animate: true, duration: 0.5 });
    if (countyGeoJson) {
      const county = findCountyAtPoint(lat, lng, countyGeoJson);
      if (county) handleSelectCounty(county);
    }
  }, [countyGeoJson, handleSelectCounty]);

  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setTempMarker([latitude, longitude]);
        mapRef.current?.setView([latitude, longitude], 12, { animate: true, duration: 0.5 });
        if (countyGeoJson) {
          const county = findCountyAtPoint(latitude, longitude, countyGeoJson);
          if (county) handleSelectCounty(county);
        }
        setLocating(false);
      },
      () => {
        mapRef.current?.setView([37.2, -119.5], 6, { animate: true, duration: 0.5 });
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, [countyGeoJson, handleSelectCounty]);

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

  const initialStagedFilters: StagedFilters = useMemo(() => ({
    selectedYears: new Set(selectedYears),
    dateRange: selectedDateRange,
    severities: new Set(selectedSeverities),
    causes: new Set(selectedCauses),
    alcohol: selectedAlcohol,
    distracted: selectedDistracted,
    pedestrian: selectedPedestrian,
    cyclist: selectedCyclist,
    drug: selectedDrug,
    driverAge: selectedDriverAge,
    weather: new Set(selectedWeather),
    lighting: new Set(selectedLighting),
    collisionType: new Set(selectedCollisionType),
    roadType: selectedRoadType,
    hitRun: selectedHitRun,
  }), [selectedDateRange, selectedSeverities, selectedCauses, selectedAlcohol, selectedDistracted, selectedPedestrian, selectedCyclist, selectedDrug, selectedDriverAge, selectedYears, selectedWeather, selectedLighting, selectedCollisionType, selectedRoadType, selectedHitRun]);

  const handleApplyFilters = useCallback((filters: StagedFilters) => {
    let start: { year: number; month: number } | null = null;
    let end: { year: number; month: number } | null = null;

    if (filters.dateRange) {
      start = filters.dateRange.start;
      end = filters.dateRange.end;
    } else if (filters.selectedYears.size > 0) {
      const years = [...filters.selectedYears].sort();
      start = { year: years[0], month: 1 };
      end = { year: years[years.length - 1], month: 12 };
    }

    setAllFilters({
      start,
      end,
      severities: filters.severities,
      causes: filters.causes,
      alcohol: filters.alcohol,
      distracted: filters.distracted,
      pedestrian: filters.pedestrian,
      cyclist: filters.cyclist,
      drug: filters.drug,
      driverAge: filters.driverAge,
      weather: filters.weather,
      lighting: filters.lighting,
      collisionType: filters.collisionType,
      roadType: filters.roadType,
      hitRun: filters.hitRun,
    });

    setShowMobileFilters(false);
    setActivePanel(null);
  }, [setAllFilters]);

  function renderPanelContent() {
    switch (activePanel) {
      case "filters":
        return (
          <FilterPanelRouter
            initial={initialStagedFilters}
            selectedCounties={selectedCounties}
            onToggleCounty={toggleCounty}
            onClearCounties={clearCounties}
            onApply={handleApplyFilters}
            onClear={handleClearAll}
          />
        );
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
      <h1 className="sr-only">California Crash Map Explorer</h1>
      {/* Sidebar — hidden on mobile */}
      <div className="hidden md:flex h-full z-40">
        <IconRail
          activePanel={activePanel}
          onPanelToggle={handleToggle}
          bottomSlot={
            <ShareButton
              onBeforeShare={handleShareFlush}
              showLabel={false}
              iconClassName="text-[24px]"
              className="p-3 text-on-surface-variant hover:bg-surface-container-highest rounded-lg transition-colors flex items-center justify-center"
            />
          }
        />
        <div
          className="transition-[width] duration-300 overflow-hidden"
          style={{ width: activePanel && meta ? (activePanel === "filters" ? 400 : 300) : 0 }}
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
      <section className="flex-1 relative transition-[margin] duration-300">
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
          tempMarker={tempMarker}
          initialView={initialViewport}
          onViewportChange={writeViewport}
        />

        {/* Mobile: share + filter buttons (right) */}
        <div className="absolute top-3 right-3 z-20 md:hidden flex items-center gap-2">
          <ShareButton
            onBeforeShare={handleShareFlush}
            showLabel={false}
            iconClassName="text-[20px]"
            className="flex items-center justify-center w-11 h-11 bg-surface-container-lowest/90 backdrop-blur-md rounded-full shadow-lg ghost-border text-on-surface"
          />
          <button
            onClick={() => setShowMobileFilters(true)}
            className="flex items-center justify-center w-11 h-11 bg-surface-container-lowest/90 backdrop-blur-md rounded-full shadow-lg ghost-border text-on-surface"
            aria-label="Open filters"
          >
            <span className="material-symbols-outlined text-[20px]">tune</span>
          </button>
        </div>

        <UnifiedSearchBar
          map={mapRef.current}
          onSelectCounty={handleSelectCounty}
          onSelectPlace={handleSelectPlace}
          onGeolocate={handleGeolocate}
          locating={locating}
          onSearchOpen={setMobileSearchOpen}
        />

        <ActiveFiltersBanner
          dateRange={selectedDateRange}
          severities={selectedSeverities}
          causes={selectedCauses}
          alcohol={selectedAlcohol}
          distracted={selectedDistracted}
          pedestrian={selectedPedestrian}
          cyclist={selectedCyclist}
          drug={selectedDrug}
          driverAge={selectedDriverAge}
          weather={selectedWeather}
          lighting={selectedLighting}
          collisionType={selectedCollisionType}
          roadType={selectedRoadType}
          hitRun={selectedHitRun}
          totalCrashes={choroplethData.dataSummary.totalCrashes}
          isLoading={choroplethData.isLoading}
          onClear={handleClearAll}
          searchOpen={mobileSearchOpen}
        />

        {!choroplethData.isLoading
          && !choroplethData.isError
          && choroplethData.dataSummary.totalCrashes === 0
          && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none p-4">
            <div className="bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-xl px-6 py-5 ambient-shadow pointer-events-auto max-w-sm space-y-4">
              <EmptyState
                icon="filter_list_off"
                title="No matching crashes"
                description="Your filters are too restrictive. Try removing some:"
              />
              <div className="flex flex-wrap gap-2 justify-center">
                {selectedSeverities.size > 0 && (
                  <button onClick={clearSeverities} className="text-[11px] font-semibold bg-primary-container text-on-primary-container px-2.5 py-1 rounded-full flex items-center gap-1 hover:opacity-80">
                    {[...selectedSeverities].join(", ")} <span className="text-[10px]">×</span>
                  </button>
                )}
                {selectedCauses.size > 0 && (
                  <button onClick={() => clearCauses()} className="text-[11px] font-semibold bg-primary-container text-on-primary-container px-2.5 py-1 rounded-full flex items-center gap-1 hover:opacity-80">
                    {selectedCauses.size} causes <span className="text-[10px]">×</span>
                  </button>
                )}
                {selectedAlcohol && (
                  <button onClick={toggleAlcohol} className="text-[11px] font-semibold bg-tertiary-container text-on-tertiary-container px-2.5 py-1 rounded-full flex items-center gap-1 hover:opacity-80">
                    Alcohol <span className="text-[10px]">×</span>
                  </button>
                )}
                {selectedPedestrian && (
                  <button onClick={togglePedestrian} className="text-[11px] font-semibold bg-tertiary-container text-on-tertiary-container px-2.5 py-1 rounded-full flex items-center gap-1 hover:opacity-80">
                    Pedestrian <span className="text-[10px]">×</span>
                  </button>
                )}
                {selectedDriverAge && (
                  <button onClick={() => setDriverAge(null)} className="text-[11px] font-semibold bg-tertiary-container text-on-tertiary-container px-2.5 py-1 rounded-full flex items-center gap-1 hover:opacity-80">
                    Age {selectedDriverAge} <span className="text-[10px]">×</span>
                  </button>
                )}
              </div>
              <button onClick={handleClearAll} className="w-full text-sm font-semibold text-primary hover:underline">
                Clear All Filters
              </button>
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
          searchOpen={mobileSearchOpen}
          mismatchCount={otherLayers.coordMismatches ? mismatchHeatmap.totalCrashes : null}
        />
        {otherLayers.heatmapStatewide && !focusedCounty && !choroplethOn && (
          <StatewideHeatmapCard
            totalCrashes={statewideHeatmap.totalCrashes}
            displayed={statewideHeatmap.points.length}
            isLoading={statewideHeatmap.isLoading}
            searchOpen={mobileSearchOpen}
          />
        )}
        {!focusedCounty && showStatewide && randomCard && (
          <AiInsightCard
            onClose={() => setShowStatewide(false)}
            countyName="California"
            data={undefined}
            measureLabel=""
            compareMode={false}
            onCompare={() => {}}
            narrative={randomCard.narrative}
            narrativeAngle={randomCard.angle}
            onRefreshNarrative={refreshRandomCard}
          />
        )}
        {heatmapEnabled && (heatmap.isLoading || (useCountyDetail && (countyHeatmap.isLoading || countyHeatmap.hasMore) && !countyHeatmap.error)) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
            <div className="bg-surface-container-lowest/95 backdrop-blur-md px-4 py-2.5 rounded-xl ghost-border shadow-lg min-w-[220px]">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
                <span className="text-xs font-medium text-on-surface-variant">Loading crash data…</span>
              </div>
              <div className="w-full h-1.5 bg-outline/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                  style={{ width: useCountyDetail && countyHeatmap.totalCrashes > 0
                    ? `${Math.min(100, (countyHeatmap.points.length / countyHeatmap.totalCrashes) * 100)}%`
                    : "0%"
                  }}
                />
              </div>
              {useCountyDetail && countyHeatmap.totalCrashes > 0 && (
                <p className="text-[10px] text-on-surface-variant/60 mt-1 text-center">
                  {countyHeatmap.points.length.toLocaleString()} / {countyHeatmap.totalCrashes.toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}
        {useCountyDetail && countyHeatmap.error && countyHeatmap.points.length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={() => countyHeatmap.retry()}
              className="bg-surface-container-lowest/95 backdrop-blur-md px-4 py-2 rounded-full ghost-border shadow-lg flex items-center gap-2 hover:bg-surface-container-low/95 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px] text-error">wifi_off</span>
              <span className="text-xs font-medium text-on-surface-variant">
                {countyHeatmap.points.length.toLocaleString()} / {countyHeatmap.totalCrashes.toLocaleString()} loaded
              </span>
              <span className="text-xs text-primary font-semibold">Retry</span>
            </button>
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
            hideFooter: true,
            content: (
              <FilterPanelRouter
                initial={initialStagedFilters}
                selectedCounties={selectedCounties}
                onToggleCounty={toggleCounty}
                onClearCounties={clearCounties}
                onApply={handleApplyFilters}
                onClear={handleClearAll}
              />
            ),
          },
          {
            key: "layers",
            label: "Layers",
            icon: "layers",
            content: <LayersPanel />,
          },
          {
            key: "export",
            label: "Export",
            icon: "file_download",
            hideFooter: true,
            content: (
              <div className="space-y-4">
                <DataExportPanel />
                <DataExportPanelFooter />
              </div>
            ),
          },
        ]}
      />

      <KeyboardHelpModal
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
      />

      <IntroOverlay onStart={handleIntroStart} />

      {showFilterPrompt && (
        <FilteredUrlPrompt
          filters={[
            ...(selectedDateRange ? [`${selectedDateRange.start?.year ?? "earliest"}–${selectedDateRange.end?.year ?? "latest"}`] : []),
            ...(selectedSeverities.size > 0 ? [...selectedSeverities] : []),
            ...(selectedCauses.size > 0 ? [`${selectedCauses.size} cause${selectedCauses.size > 1 ? "s" : ""}`] : []),
            ...(selectedAlcohol ? ["Alcohol"] : []),
            ...(selectedDistracted ? ["Distracted"] : []),
            ...(selectedPedestrian ? ["Pedestrian"] : []),
            ...(selectedCyclist ? ["Cyclist"] : []),
            ...(selectedDrug ? ["Drug"] : []),
            ...(selectedDriverAge ? [`Age ${selectedDriverAge}`] : []),
          ]}
          onViewFiltered={() => { sessionStorage.setItem("calsight-filter-prompt-dismissed", "1"); setShowFilterPrompt(false); }}
          onShowAll={() => { sessionStorage.setItem("calsight-filter-prompt-dismissed", "1"); clearFilters(); setShowFilterPrompt(false); }}
        />
      )}
    </>
  );
}

export default function MapPage() {
  // Layer state ↔ URL: layerSeed decodes the URL on mount; writeLayerParams
  // mirrors changes back. Kept here (inside <BrowserRouter>) so the provider
  // itself stays Router-agnostic.
  const { layerSeed, writeLayerParams } = useLayerParams();
  return (
    <LayersStateProvider urlSeed={layerSeed} onStateChange={writeLayerParams}>
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

