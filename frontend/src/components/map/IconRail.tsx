interface IconRailProps {
  activePanel: string | null;
  onPanelToggle: (panel: string) => void;
}

const icons = [
  { panel: "filters", icon: "filter_list", label: "Filters" },
  { panel: "layers", icon: "layers", label: "Layers" },
] as const;

export default function IconRail({ activePanel, onPanelToggle }: IconRailProps) {
  return (
    <aside className="w-20 bg-surface-container flex flex-col items-center py-6 gap-6 h-full flex-shrink-0">
      {icons.map(({ panel, icon, label }) => {
        const isActive = activePanel === panel;
        return (
          <button
            key={panel}
            aria-label={label}
            onClick={() => onPanelToggle(panel)}
            className={
              isActive
                ? "p-3 bg-surface-container-lowest text-primary relative transition-colors"
                : "p-3 text-on-surface-variant hover:bg-surface-container-highest rounded-lg transition-colors"
            }
          >
            <span className="material-symbols-outlined">{icon}</span>
            {isActive && (
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-surface-container-lowest" />
            )}
          </button>
        );
      })}
    </aside>
  );
}
