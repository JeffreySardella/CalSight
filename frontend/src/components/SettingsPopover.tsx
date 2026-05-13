import { useEffect, useRef } from "react";
import { useTheme, type Theme } from "../context/ThemeContext";
import { useLiteMode, type LiteModeSetting } from "../context/LiteModeContext";
import { useAccessibility, type MotionPref, type TextSize } from "../context/AccessibilityContext";

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "monitor" },
];

const LITE_OPTIONS: { value: LiteModeSetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const MOTION_OPTIONS: { value: MotionPref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "on", label: "Reduce" },
  { value: "off", label: "Off" },
];

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
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
  const { motion, setMotion, highContrast, setHighContrast, textSize, setTextSize, effectiveReducedMotion } = useAccessibility();
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
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-2 w-72 rounded-xl bg-surface-container-low/80 backdrop-blur-xl ghost-border ambient-shadow p-4 z-50 space-y-4 max-h-[80vh] overflow-y-auto no-scrollbar"
    >
      {/* Display theme */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-3">
          Display
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

      {/* Lite Mode */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
            Lite Mode
          </span>
          {isLite && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary-container px-2 py-0.5 rounded-full">
              Active
            </span>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1">
          {LITE_OPTIONS.map(({ value, label }) => (
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
          Reduces blur effects and animations for smoother performance on slower devices. Auto detects your connection speed.
        </p>
      </div>

      <div className="border-t border-outline-variant/20" />

      {/* Accessibility heading */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">accessibility_new</span>
          Accessibility
        </span>
      </div>

      {/* Text Size */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-3">
          Text Size
        </span>
        <div className="flex gap-1 rounded-lg bg-surface-container p-1">
          {TEXT_SIZE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTextSize(value)}
              className={`flex-1 flex items-center justify-center rounded-md px-2 py-1.5 font-medium transition-colors ${
                textSize === value ? CHIP_ACTIVE : CHIP_INACTIVE
              }`}
              style={{ fontSize: value === "sm" ? 11 : value === "lg" ? 15 : 13 }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
          Increases text contrast and adds visible borders for better readability.
        </p>
      </div>

      {/* Reduced Motion */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body">
            Motion
          </span>
          {effectiveReducedMotion && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary-container px-2 py-0.5 rounded-full">
              Reduced
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
          Disables animations and transitions. System respects your OS preference.
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
  );
}
