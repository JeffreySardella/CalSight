import { useState, useEffect } from "react";

type TabKey = "filters" | "layers" | "export";

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
  content: React.ReactNode;
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

  if (!isOpen) return null;

  const currentTab = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <div className="fixed inset-0 z-[100] md:hidden">
      {/* Dimmed backdrop */}
      <div
        className={`absolute inset-0 bg-on-surface/20 backdrop-blur-sm transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        className={`absolute bottom-0 left-0 right-0 rounded-t-xl bg-surface-container-lowest max-h-[80vh] flex flex-col transition-transform duration-300 ease-out ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
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
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
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

        {/* Sticky footer */}
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
      </div>
    </div>
  );
}
