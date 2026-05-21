import { useCallback } from "react";
import {
  setPreferences,
  useUserPreferences,
} from "../../../hooks/useUserPreferences";
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
  const { filterMode: mode } = useUserPreferences();

  const switchToAdvanced = useCallback(() => {
    setPreferences({ filterMode: "advanced" });
  }, []);

  const switchToSimple = useCallback(() => {
    setPreferences({ filterMode: "simple" });
  }, []);

  return (
    <div className="space-y-4">
      {/* Mode toggle — always visible */}
      <div className="flex gap-1 rounded-lg bg-surface-container p-1">
        <button
          onClick={switchToSimple}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all ${
            mode === "simple"
              ? "bg-primary-container text-on-primary-container"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">tune</span>
          Simple
        </button>
        <button
          onClick={switchToAdvanced}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition-all ${
            mode === "advanced"
              ? "bg-primary-container text-on-primary-container"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">settings</span>
          Advanced
        </button>
      </div>

      {/* Panel content */}
      {mode === "simple" ? (
        <SimpleFilterPanel {...props} />
      ) : (
        <FilterWizard {...props} />
      )}
    </div>
  );
}
