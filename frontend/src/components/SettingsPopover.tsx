import { useEffect, useRef } from "react";
import { useTheme, type Theme } from "../context/ThemeContext";
import { useLiteMode, type LiteModeSetting } from "../context/LiteModeContext";
import { useAccessibility, type MotionPref } from "../context/AccessibilityContext";

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "monitor" },
];

const PERF_OPTIONS: { value: LiteModeSetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const MOTION_OPTIONS: { value: MotionPref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "on", label: "Reduce" },
  { value: "off", label: "Off" },
];

const CHIP_ACTIVE = "bg-primary-container text-on-primary-container";
const CHIP_INACTIVE = "text-on-surface-variant hover:text-on-surface";

interface SettingsPopoverProps {
  onClose: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export default function SettingsPopover({ onClose, containerRef }: SettingsPopoverProps) {
  const { theme, setTheme } = useTheme();
  const { setting: liteSetting, setSetting: setLiteSetting, isLite } = useLiteMode();
  const { motion, setMotion, highContrast, setHighContrast, effectiveReducedMotion } = useAccessibility();
  const popoverRef = useRef<HTMLDivElement>(null);

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
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <>
    {/* Mobile: backdrop */}
    <div role="button" tabIndex={-1} className="fixed inset-0 z-[49] bg-on-surface/20 md:hidden" onClick={onClose} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClose(); }} aria-label="Close settings" />
    <div
      ref={popoverRef}
      className="fixed bottom-0 left-0 right-0 z-50 w-full rounded-t-2xl bg-surface-container-low backdrop-blur-xl ghost-border ambient-shadow p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] space-y-4 max-h-[85vh] overflow-y-auto no-scrollbar md:absolute md:bottom-auto md:left-auto md:right-0 md:top-full md:mt-2 md:w-72 md:rounded-xl md:rounded-t-xl md:pb-4"
    >
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

      {/* Performance */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
            Performance
          </span>
          {isLite && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary-container px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1">
          {PERF_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setLiteSetting(value)}
              className={`flex-1 flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                liteSetting === value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-on-surface-variant mt-2 leading-relaxed">
          Reduces blur and animations for slower devices. Auto detects your hardware.
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

      {/* Reduced Motion */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
            Reduce Motion
          </span>
          {effectiveReducedMotion && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary-container px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1">
          {MOTION_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setMotion(value)}
              className={`flex-1 flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                motion === value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-on-surface-variant mt-2 leading-relaxed">
          Stops animations and map zoom transitions. System follows your OS setting.
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
            ["+  /  −", "Zoom"],
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
    </div>
    </>
  );
}
