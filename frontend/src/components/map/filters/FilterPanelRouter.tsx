import { useState, useCallback } from "react";
import type { StagedFilters } from "../../../hooks/useStagedFilters";
import SimpleFilterPanel from "./SimpleFilterPanel";
import FilterWizard from "./FilterWizard";

interface FilterPanelRouterProps {
  initial: StagedFilters;
  selectedCounties: Set<string>;
  onToggleCounty: (county: string) => void;
  onClearCounties: () => void;
  onApply: (filters: StagedFilters) => void;
  onClear: () => void;
}

export default function FilterPanelRouter(props: FilterPanelRouterProps) {
  const [mode, setMode] = useState<"simple" | "advanced">(() => {
    return (localStorage.getItem("calsight-filter-mode") as "simple" | "advanced") || "simple";
  });

  const switchToAdvanced = useCallback(() => {
    setMode("advanced");
    localStorage.setItem("calsight-filter-mode", "advanced");
  }, []);

  const switchToSimple = useCallback(() => {
    setMode("simple");
    localStorage.setItem("calsight-filter-mode", "simple");
  }, []);

  if (mode === "simple") {
    return (
      <SimpleFilterPanel
        {...props}
        onSwitchToAdvanced={switchToAdvanced}
      />
    );
  }

  return (
    <FilterWizard
      {...props}
      onSwitchToSimple={switchToSimple}
    />
  );
}
