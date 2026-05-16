import { useEffect } from "react";
import type { PresetKey } from "../lib/dashboard/types";
import { PRESET_KEYS } from "../lib/dashboard/presets";

interface UseDashboardKeyboardOptions {
  onSetMode: (mode: "simple" | "advanced") => void;
  onSetPreset: (preset: PresetKey) => void;
  onCloseConfig: () => void;
  enabled?: boolean;
}

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Keyboard shortcuts for the dashboard builder.
 *
 * - 1-8: switch to preset by index (PRESET_KEYS[n-1]), also sets mode to "simple"
 * - B: toggle builder mode (advanced)
 * - Escape: close config panel if open
 */
export function useDashboardKeyboard({
  onSetMode,
  onSetPreset,
  onCloseConfig,
  enabled = true,
}: UseDashboardKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;

      // Number keys 1-8: switch to preset
      if (e.key >= "1" && e.key <= "8") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < PRESET_KEYS.length) {
          e.preventDefault();
          onSetPreset(PRESET_KEYS[idx]);
        }
        return;
      }

      switch (e.key) {
        case "b":
        case "B": {
          e.preventDefault();
          onSetMode("advanced");
          break;
        }

        case "Escape": {
          e.preventDefault();
          onCloseConfig();
          break;
        }

        default:
          return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onSetMode, onSetPreset, onCloseConfig]);
}
