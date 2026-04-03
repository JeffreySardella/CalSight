import { useEffect, useRef } from "react";
import { useTheme } from "../context/ThemeContext";

type Theme = "light" | "dark" | "system";

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "monitor" },
];

interface SettingsPopoverProps {
  onClose: () => void;
}

export default function SettingsPopover({ onClose }: SettingsPopoverProps) {
  const { theme, setTheme } = useTheme();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
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
      className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-surface-container-low/80 backdrop-blur-xl ghost-border ambient-shadow p-4 z-50"
    >
      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-body block mb-3">
        Display
      </label>

      <div className="flex gap-1 rounded-lg bg-surface-container p-1">
        {THEME_OPTIONS.map(({ value, label, icon }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${
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
  );
}
