import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useQueryClient } from "@tanstack/react-query";
import { useFilterParams, CA_COUNTIES } from "../hooks/useFilterParams";
import { useMapKeyboard } from "../hooks/useMapKeyboard";
import { LayersStateProvider, useLayersState } from "../hooks/useLayersState";
import ChoroplethLegend from "../components/map/ChoroplethLegend";
import { useChoroplethData } from "../hooks/useChoroplethData";
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
import SearchPill from "../components/map/SearchPill";
import Breadcrumb from "../components/map/Breadcrumb";
import MobileFilterSheet from "../components/map/MobileFilterSheet";

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
  const [showHelp, setShowHelp] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [insightCounty, setInsightCounty] = useState("Fresno");
  const mapRef = useRef<LeafletMap | null>(null);

  const countyNames = CA_COUNTIES.map((c) => String(c)).sort();

  const handleMapReady = useCallback((map: LeafletMap) => {
    mapRef.current = map;
  }, []);

  const handleSelectCounty = useCallback((name: string) => {
    setInsightCounty(name);
    setShowInsight(true);
  }, []);

  function handleClearAll() {
    clearFilters();
    setResetKey((k) => k + 1);
  }

  const handleCloseOverlay = useCallback(() => {
    if (showHelp) {
      setShowHelp(false);
    } else if (showInsight) {
      setShowInsight(false);
    } else if (activePanel) {
      setActivePanel(null);
    } else if (showMobileFilters) {
      setShowMobileFilters(false);
    }
  }, [showHelp, showInsight, activePanel, showMobileFilters]);

  useMapKeyboard({
    map: mapRef.current,
    counties: countyNames,
    focusedCounty,
    onFocusCounty: setFocusedCounty,
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
          onFocusCounty={setFocusedCounty}
          onSelectCounty={handleSelectCounty}
          onMapReady={handleMapReady}
        />

        {/* Mobile-only floating Filters chip */}
        <button
          onClick={() => setShowMobileFilters(true)}
          className="absolute top-4 right-4 z-20 md:hidden flex items-center gap-1.5 bg-surface-container-lowest/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg ghost-border text-on-surface text-sm font-semibold"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Filters
        </button>

        {showInsight && (
          <AiInsightCard onClose={() => setShowInsight(false)} countyName={insightCounty} />
        )}
        <SearchPill map={mapRef.current} onExpandedChange={setSearchOpen} />
        <Breadcrumb />
        <ChoroplethLegendContainer searchOpen={searchOpen} />
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
          {
            key: "export",
            label: "Export",
            icon: "file_download",
            content: <DataExportPanel />,
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

function ChoroplethLegendContainer({ searchOpen }: { searchOpen?: boolean }) {
  const { selectedYears, selectedSeverities, selectedCauses } = useFilterParams();
  const { measure } = useLayersState();
  const queryClient = useQueryClient();
  // Must match the filter shape used in CountyBoundaries so React Query
  // dedupes the stats request to a single /api/stats fetch.
  // NOTE: alcohol/distracted are NOT included — /api/stats can't filter
  // by those flags (materialized views don't carry them).
  const filters = useMemo(
    () => ({
      years: [...selectedYears].sort((a, b) => a - b),
      severities: [...selectedSeverities],
      causes: [...selectedCauses],
    }),
    [selectedYears, selectedSeverities, selectedCauses],
  );
  const { demographicsAvailable, isError, isLoading, is422 } = useChoroplethData(measure, filters);
  return (
    <ChoroplethLegend
      demographicsAvailable={demographicsAvailable}
      isLoading={isLoading}
      isError={isError}
      is422={is422}
      searchOpen={searchOpen}
      onRetry={() => queryClient.invalidateQueries({ queryKey: ["choropleth"] })}
    />
  );
}
