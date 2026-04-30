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
import { useCrashHeatmap } from "../hooks/useCrashHeatmap";
import MobileFilterSheet from "../components/map/MobileFilterSheet";
import { useCoordCoverage } from "../hooks/useCoordCoverage";

const PANEL_META: Record<string, { title: string; subtitle: string }> = {
  filters: { title: "Filters", subtitle: "Secondary Parameters" },
  layers: { title: "Layers", subtitle: "Map Configuration" },
  export: { title: "Data Export", subtitle: "Export Explorer" },
};

const VALID_PANELS = new Set(Object.keys(PANEL_META));

function MapPageInner() {
  const {
    selectedYears,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    selectedAlcohol,
    selectedDistracted,
    toggleYear,
    setYearRange,
    setYears,
    clearYears,
    setAllYears,
    toggleSeverity,
    toggleCounty,
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
    clearFilters,
    panel: panelParam,
    clearPanel,
  } = useFilterParams();

  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [showInsight, setShowInsight] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [focusedCounty, setFocusedCounty] = useState<string | null>(null);
  const [compareCounty, setCompareCounty] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchOpen] = useState(false);
  const [insightCounty, setInsightCounty] = useState("Fresno");
  const mapRef = useRef<LeafletMap | null>(null);

  const countyNames = CA_COUNTIES.map((c) => String(c)).sort();

  const { measure, otherLayers, heatmapResolution, palette, toggleOtherLayer } = useLayersState();

  const heatmapCountySlugs = (() => {
    if (focusedCounty || compareCounty) {
      const slugs: string[] = [];
      if (focusedCounty) slugs.push(focusedCounty.toLowerCase().replace(/\s+/g, "-"));
      if (compareCounty) slugs.push(compareCounty.toLowerCase().replace(/\s+/g, "-"));
      return slugs.join(",");
    }
    if (selectedCounties.size > 0) {
      return [...selectedCounties].map((c) => c.toLowerCase().replace(/\s+/g, "-")).join(",");
    }
    return null;
  })();

  const hasCountyScope = !!focusedCounty || selectedCounties.size > 0;
  const effectiveResolution = hasCountyScope ? "raw" as const : heatmapResolution;

  const heatmap = useCrashHeatmap({
    enabled: otherLayers.heatmap,
    county: heatmapCountySlugs,
    years: [...selectedYears],
    severities: [...selectedSeverities],
    causes: [...selectedCauses],
    resolution: effectiveResolution,
  });

  const coordCoverage = useCoordCoverage([...selectedYears]);
  const choroplethFilters = useMemo(
    () => ({
      years: [...selectedYears].sort((a, b) => a - b),
      severities: [...selectedSeverities],
      causes: [...selectedCauses],
    }),
    [selectedYears, selectedSeverities, selectedCauses],
  );
  const choroplethData = useChoroplethData(measure, choroplethFilters);

  const inspectedCode = focusedCounty ? choroplethData.nameToCode[focusedCounty] : undefined;
  const inspectedData = inspectedCode != null ? choroplethData.byCountyCode[inspectedCode] : undefined;
  const compareCode = compareCounty ? choroplethData.nameToCode[compareCounty] : undefined;
  const comparePointData = compareCode != null ? choroplethData.byCountyCode[compareCode] : undefined;
  const measureLabel = MEASURES[measure].label;

  const handleMapReady = useCallback((map: LeafletMap) => {
    mapRef.current = map;
  }, []);

  const handleSelectCounty = useCallback((name: string) => {
    if (compareMode && name !== focusedCounty) {
      setCompareCounty(name);
    } else {
      if (!otherLayers.heatmap) toggleOtherLayer("heatmap");
      setFocusedCounty(name);
      setInsightCounty(name);
      setShowInsight(true);
      setCompareCounty(null);
      setCompareMode(false);
    }
  }, [compareMode, focusedCounty, otherLayers.heatmap, toggleOtherLayer]);

  const handleDeselect = useCallback(() => {
    setFocusedCounty(null);
    setCompareCounty(null);
    setCompareMode(false);
    setShowInsight(false);
    if (otherLayers.heatmap) toggleOtherLayer("heatmap");
  }, [otherLayers.heatmap, toggleOtherLayer]);

  const handleStartCompare = useCallback(() => {
    setCompareMode(true);
  }, []);

  const handleFocusCounty = useCallback((name: string | null) => {
    if (compareMode && name !== null) return;
    setFocusedCounty(name);
    if (name === null) {
      setCompareCounty(null);
      setCompareMode(false);
      setShowInsight(false);
      if (otherLayers.heatmap) toggleOtherLayer("heatmap");
    }
  }, [compareMode, otherLayers.heatmap, toggleOtherLayer]);

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
    selectedYears,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    selectedAlcohol,
    selectedDistracted,
    onToggleYear: toggleYear,
    onSetYearRange: setYearRange,
    onSetYears: setYears,
    onClearYears: clearYears,
    onSetAllYears: setAllYears,
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
          heatmapActive={otherLayers.heatmap}
          heatmapResolution={effectiveResolution}
          heatmapPalette={palette}
        />

        {/* Mobile-only floating Filters chip */}
        <button
          onClick={() => setShowMobileFilters(true)}
          className="absolute top-4 right-4 z-20 md:hidden flex items-center gap-1.5 bg-surface-container-lowest/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg ghost-border text-on-surface text-sm font-semibold"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Filters
        </button>

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
          />
        )}
        <Breadcrumb
          inspectedCounty={focusedCounty}
          compareCounty={compareCounty}
          onDeselect={handleDeselect}
        />
        <ChoroplethLegendContainer
          searchOpen={searchOpen}
          choroplethData={choroplethData}
          coordCoverage={coordCoverage}
          heatmapCrashes={otherLayers.heatmap ? heatmap.totalCrashes : null}
          heatmapLoading={otherLayers.heatmap && heatmap.isLoading}
          countyActive={!!focusedCounty}
        />
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
  searchOpen,
  choroplethData,
  coordCoverage,
  heatmapCrashes,
  heatmapLoading,
  countyActive,
}: {
  searchOpen?: boolean;
  choroplethData: ChoroplethData;
  coordCoverage?: CoordCoverage | null;
  heatmapCrashes?: number | null;
  heatmapLoading?: boolean;
  countyActive?: boolean;
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
      heatmapLoading={heatmapLoading}
      countyActive={countyActive}
    />
  );
}
