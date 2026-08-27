import { useEffect, useRef, useState } from "react";

/** 3+ counties makes point density on top of the choropleth unreadable. */
export const MAX_COUNTIES_FOR_HEATMAP = 3;

interface SuppressionArgs {
  selectedCountiesSize: number;
  /** Whether either heatmap layer is switched on in the user's layer prefs. */
  heatmapRequested: boolean;
}

interface Suppression {
  /** Hide the heatmap layers for as long as the selection is this wide. */
  suppressed: boolean;
  noteVisible: boolean;
  dismissNote: () => void;
}

/**
 * Steps the heatmap layers aside while too many counties are selected.
 *
 * Derived, never stored. The previous version switched the layer toggles off
 * instead, and LayersStateProvider persists those toggles to localStorage — so
 * one look at three counties turned the heatmap off for good, across reloads.
 * Clicking a county afterwards drew nothing, with no hint why, until the user
 * found "County Detail" in the Layers panel again. Suppressing at the point of
 * use means the layer returns by itself the moment the selection narrows, and
 * the user's saved preference is never overwritten.
 *
 * The notice fires once per episode and clears when the selection narrows.
 */
export function useHeatmapSuppression({
  selectedCountiesSize,
  heatmapRequested,
}: SuppressionArgs): Suppression {
  const suppressed = selectedCountiesSize >= MAX_COUNTIES_FOR_HEATMAP;
  const announcedRef = useRef(false);
  const [noteVisible, setNoteVisible] = useState(false);

  useEffect(() => {
    if (!suppressed) {
      announcedRef.current = false;
      setNoteVisible(false);
      return;
    }
    if (announcedRef.current) return;
    if (!heatmapRequested) return;
    announcedRef.current = true;
    setNoteVisible(true);
  }, [suppressed, heatmapRequested]);

  useEffect(() => {
    if (!noteVisible) return;
    const t = setTimeout(() => setNoteVisible(false), 5000);
    return () => clearTimeout(t);
  }, [noteVisible]);

  return { suppressed, noteVisible, dismissNote: () => setNoteVisible(false) };
}
