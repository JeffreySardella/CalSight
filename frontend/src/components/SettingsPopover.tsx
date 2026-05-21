import { useEffect, useRef, useState } from "react";
import FocusTrap from "focus-trap-react";
import { useTheme, type Theme } from "../context/ThemeContext";
import { useAccessibility } from "../context/AccessibilityContext";
import { CA_COUNTIES } from "../hooks/useFilterParams";
import {
  setPreferences,
  useUserPreferences,
} from "../hooks/useUserPreferences";
import ThemeCustomizer from "./settings/ThemeCustomizer";

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "monitor" },
];


const CHIP_ACTIVE = "bg-primary-container text-on-primary-container";
const CHIP_INACTIVE = "text-on-surface-variant hover:text-on-surface";

interface SettingsPopoverProps {
  onClose: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

type SettingsTab = "general" | "appearance";

export default function SettingsPopover({ onClose, containerRef }: SettingsPopoverProps) {
  const { theme, setTheme } = useTheme();
  const { highContrast, setHighContrast } = useAccessibility();
  const { defaultCounty } = useUserPreferences();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SettingsTab>("general");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target) &&
          (!containerRef?.current || !containerRef.current.contains(target))) {
        onClose();
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    const isMobileSheet = window.innerWidth < 768;
    if (isMobileSheet) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      if (isMobileSheet) document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <>
    {/* Mobile: backdrop */}
    <div role="button" tabIndex={-1} className="fixed inset-0 z-[60] bg-on-surface/20 md:hidden" onClick={onClose} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }} aria-label="Close settings" />
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false }}>
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      className="fixed bottom-0 left-0 right-0 z-[61] w-full rounded-t-2xl bg-surface-container-low backdrop-blur-xl ghost-border ambient-shadow p-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] space-y-4 max-h-[85vh] overflow-y-auto md:absolute md:bottom-auto md:left-auto md:right-0 md:top-full md:mt-2 md:w-80 md:rounded-xl md:rounded-t-xl md:pb-4"
    >
      {/* Mobile drag handle */}
      <div className="flex justify-center md:hidden py-1">
        <div className="w-10 h-1 rounded-full bg-on-surface-variant/30" />
      </div>

      {/* Header with close button */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-headline font-bold text-on-surface">Settings</h2>
        <button onClick={onClose} className="px-3 py-1.5 rounded-full text-primary text-sm font-bold hover:bg-primary/10 transition-colors min-h-[36px]" aria-label="Close settings">
          Done
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-surface-container p-1">
        <button
          onClick={() => setTab("general")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            tab === "general" ? CHIP_ACTIVE : CHIP_INACTIVE
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">settings</span>
          General
        </button>
        <button
          onClick={() => setTab("appearance")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            tab === "appearance" ? CHIP_ACTIVE : CHIP_INACTIVE
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">palette</span>
          Appearance
        </button>
      </div>

      {tab === "general" ? (
        <>
          {/* Theme */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-3">
              Theme
            </span>
            <div className="flex gap-1 rounded-lg bg-surface-container p-1">
              {THEME_OPTIONS.map(({ value, label, icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    theme === value ? CHIP_ACTIVE : CHIP_INACTIVE
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-outline-variant/20" />

          {/* Default county */}
          <div>
            <label htmlFor="default-county-select" className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-3">
              Default county
            </label>
            <select
              id="default-county-select"
              value={defaultCounty ?? ""}
              onChange={(e) => setPreferences({ defaultCounty: e.target.value || null })}
              className="w-full rounded-lg bg-surface-container text-on-surface text-xs font-medium px-3 py-2 ghost-border focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">None (statewide)</option>
              {CA_COUNTIES.map((county) => (
                <option key={county} value={county}>{county}</option>
              ))}
            </select>
            <p className="text-[9px] text-on-surface-variant mt-1.5 leading-relaxed">
              Applied on Map / Stats pages when no county is set in the URL.
            </p>
          </div>

          <div className="border-t border-outline-variant/20" />

          {/* High Contrast */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
                High Contrast
              </span>
              <button
                role="switch"
                aria-checked={highContrast}
                onClick={() => setHighContrast(!highContrast)}
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  highContrast ? "bg-primary" : "bg-outline-variant"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface-container-lowest transition-transform ${
                  highContrast ? "translate-x-4" : ""
                }`} />
              </button>
            </div>
            <p className="text-[9px] text-on-surface-variant mt-1.5 leading-relaxed">
              Darkens secondary text and strengthens borders.
            </p>
          </div>

          <div className="border-t border-outline-variant/20" />

          {/* Keyboard shortcuts */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-2">
              Keyboard
            </span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[
                ["Tab", "Next county"],
                ["Enter", "Open insight"],
                ["Esc", "Close overlay"],
                ["+  /  -", "Zoom"],
                ["Arrows", "Pan map"],
                ["?", "Shortcut help"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2">
                  <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-container text-on-surface text-[10px] font-mono font-semibold min-w-[28px] justify-center">
                    {key}
                  </kbd>
                  <span className="text-[10px] text-on-surface-variant">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <ThemeCustomizer />
      )}
    </div>
    </FocusTrap>
    </>
  );
}
