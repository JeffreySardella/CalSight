import { useEffect, useRef } from "react";
import { useTheme, type Theme } from "../context/ThemeContext";
import { useLiteMode, type LiteModeSetting } from "../context/LiteModeContext";

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

interface SettingsPopoverProps {
  onClose: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export default function SettingsPopover({ onClose, containerRef }: SettingsPopoverProps) {
  const { theme, setTheme } = useTheme();
  const { setting: liteSetting, setSetting: setLiteSetting, isLite } = useLiteMode();
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
      className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-surface-container-low/80 backdrop-blur-xl ghost-border ambient-shadow p-4 z-50 space-y-4"
    >
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
                theme === value
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {icon}
              </span>
              {label}
            </button>
          ))}
        </div>
      </div>

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
                liteSetting === value
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface"
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
    </div>
  );
}
