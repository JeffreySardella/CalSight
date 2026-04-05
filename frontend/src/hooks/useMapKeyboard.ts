import { useEffect } from "react";
import type { Map as LeafletMap } from "leaflet";

interface UseMapKeyboardOptions {
  map: LeafletMap | null;
  counties: string[];
  focusedCounty: string | null;
  onFocusCounty: (name: string | null) => void;
  onSelectCounty: (name: string) => void;
  onCloseOverlay: () => void;
  onToggleHelp: () => void;
  enabled?: boolean;
}

const PAN_PIXELS = 100;

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useMapKeyboard({
  map,
  counties,
  focusedCounty,
  onFocusCounty,
  onSelectCounty,
  onCloseOverlay,
  onToggleHelp,
  enabled = true,
}: UseMapKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;

      switch (e.key) {
        case "Tab": {
          if (counties.length === 0) return;
          e.preventDefault();
          const currentIndex = focusedCounty
            ? counties.indexOf(focusedCounty)
            : -1;

          let nextIndex: number;
          if (e.shiftKey) {
            nextIndex = currentIndex <= 0
              ? counties.length - 1
              : currentIndex - 1;
          } else {
            nextIndex = currentIndex >= counties.length - 1
              ? 0
              : currentIndex + 1;
          }
          onFocusCounty(counties[nextIndex]);
          break;
        }

        case "Enter": {
          if (focusedCounty) {
            e.preventDefault();
            onSelectCounty(focusedCounty);
          }
          break;
        }

        case "Escape": {
          e.preventDefault();
          onCloseOverlay();
          break;
        }

        case "ArrowUp": {
          if (!map) return;
          e.preventDefault();
          map.panBy([0, -PAN_PIXELS], { animate: true });
          break;
        }

        case "ArrowDown": {
          if (!map) return;
          e.preventDefault();
          map.panBy([0, PAN_PIXELS], { animate: true });
          break;
        }

        case "ArrowLeft": {
          if (!map) return;
          e.preventDefault();
          map.panBy([-PAN_PIXELS, 0], { animate: true });
          break;
        }

        case "ArrowRight": {
          if (!map) return;
          e.preventDefault();
          map.panBy([PAN_PIXELS, 0], { animate: true });
          break;
        }

        case "+":
        case "=": {
          if (!map) return;
          e.preventDefault();
          map.zoomIn(1, { animate: true });
          break;
        }

        case "-": {
          if (!map) return;
          e.preventDefault();
          map.zoomOut(1, { animate: true });
          break;
        }

        case "?": {
          e.preventDefault();
          onToggleHelp();
          break;
        }

        default:
          return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    map, counties, focusedCounty, enabled,
    onFocusCounty, onSelectCounty, onCloseOverlay, onToggleHelp,
  ]);
}
