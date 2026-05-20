import FocusTrap from "focus-trap-react";

interface FilteredUrlPromptProps {
  filters: string[];
  onViewFiltered: () => void;
  onShowAll: () => void;
}

export default function FilteredUrlPrompt({ filters, onViewFiltered, onShowAll }: FilteredUrlPromptProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-on-surface/30 backdrop-blur-sm" />
      <FocusTrap>
      <div role="dialog" aria-modal="true" aria-label="Filtered URL" className="relative bg-surface-container-lowest rounded-xl ambient-shadow px-6 py-5 max-w-sm w-full space-y-4">
        <h2 className="text-lg font-bold text-on-surface font-headline">Filtered View</h2>
        <p className="text-sm text-on-surface-variant">
          This link has filters applied:
        </p>
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <span key={f} className="text-[11px] font-semibold bg-primary-container text-on-primary-container px-2.5 py-1 rounded-full">
              {f}
            </span>
          ))}
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onShowAll}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-on-surface-variant bg-surface-container-high hover:bg-surface-variant transition-colors"
          >
            Show All Data
          </button>
          <button
            onClick={onViewFiltered}
            className="flex-1 py-3 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity"
          >
            View Filtered
          </button>
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
