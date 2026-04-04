import { useState, useEffect } from "react";
import { useFilterParams } from "../hooks/useFilterParams";
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

export default function MapPage() {
  const {
    selectedYears,
    selectedSeverities,
    selectedCounties,
    selectedCauses,
    toggleYear,
    setYearRange,
    clearYears,
    toggleSeverity,
    toggleCounty,
    clearCounties,
    toggleCause,
    clearFilters,
    panel: panelParam,
    clearPanel,
  } = useFilterParams();

  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [showInsight, setShowInsight] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  function handleClearAll() {
    clearFilters();
    setResetKey((k) => k + 1);
  }

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

  function renderPanelContent() {
    switch (activePanel) {
      case "filters":
        return (
          <FiltersPanel
            selectedYears={selectedYears}
            selectedSeverities={selectedSeverities}
            selectedCounties={selectedCounties}
            selectedCauses={selectedCauses}
            onToggleYear={toggleYear}
            onSetYearRange={setYearRange}
            onClearYears={clearYears}
            onToggleSeverity={toggleSeverity}
            onToggleCounty={toggleCounty}
            onClearCounties={clearCounties}
            onToggleCause={toggleCause}
            resetKey={resetKey}
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
        <MapCanvas />

        {/* Mobile-only floating Filters chip */}
        <button
          onClick={() => setShowMobileFilters(true)}
          className="absolute top-4 right-4 z-20 md:hidden flex items-center gap-1.5 bg-surface-container-lowest/90 backdrop-blur-md px-4 py-2 rounded-full shadow-lg ghost-border text-on-surface text-sm font-semibold"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Filters
        </button>

        {showInsight && (
          <AiInsightCard onClose={() => setShowInsight(false)} />
        )}
        <SearchPill />
        <Breadcrumb />
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
              <FiltersPanel
                selectedYears={selectedYears}
                selectedSeverities={selectedSeverities}
                selectedCounties={selectedCounties}
                selectedCauses={selectedCauses}
                onToggleYear={toggleYear}
                onSetYearRange={setYearRange}
                onClearYears={clearYears}
                onToggleSeverity={toggleSeverity}
                onToggleCounty={toggleCounty}
                onClearCounties={clearCounties}
                onToggleCause={toggleCause}
                resetKey={resetKey}
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
            content: <DataExportPanel />,
          },
        ]}
      />
    </>
  );
}
