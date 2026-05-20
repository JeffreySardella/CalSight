import { useState, useEffect } from "react";
import FocusTrap from "focus-trap-react";

type TabKey = "filters" | "layers" | "export";

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
  content: React.ReactNode;
  hideFooter?: boolean;
}

interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
  tabs: Tab[];
}

export default function MobileFilterSheet({
  isOpen,
  onClose,
  onClear,
  tabs,
}: MobileFilterSheetProps) {
  const [visible, setVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("filters");

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  // Reset to filters tab when reopened
  useEffect(() => {
    if (isOpen) setActiveTab("filters");
  }, [isOpen]);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentTab = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dimmed backdrop */}
      <div
        role="button"
        tabIndex={-1}
        className={`absolute inset-0 bg-on-surface/20 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }}
        aria-label="Close filters"
      />

      {/* Mobile: bottom sheet. Desktop: centered modal */}
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={currentTab.label}
        className={`absolute bg-surface-container-lowest max-h-[80vh] flex flex-col transition-[transform,opacity] duration-300 ease-out will-change-transform
          bottom-0 left-0 right-0 rounded-t-xl
          md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:w-[480px] md:max-w-[90vw] md:ambient-shadow
          ${visible ? "translate-y-0 md:opacity-100 md:scale-100" : "translate-y-full md:opacity-0 md:scale-95 md:translate-y-0"}`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-12 h-1.5 bg-outline-variant/30 rounded-full" />
        </div>

        {/* Header with close */}
        <div className="flex items-center justify-between px-6 pt-2 pb-0">
          <h2 className="text-2xl font-bold text-on-surface font-headline">
            {currentTab.label}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex px-6 pt-2 pb-0 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:bg-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {currentTab.content}
        </div>

        {/* Sticky footer — hidden when tab has its own nav (e.g. FilterWizard) */}
        {!currentTab.hideFooter && (
          <div className="px-6 py-5 border-t border-outline-variant/15 flex items-center gap-4" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
            <button
              onClick={onClear}
              className="text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-primary text-on-primary py-4 rounded-xl text-sm font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        )}
      </div>
      </FocusTrap>
    </div>
  );
}
