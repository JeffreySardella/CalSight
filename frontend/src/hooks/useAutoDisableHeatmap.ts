import { useEffect, useRef, useState } from "react";

interface AutoDisableArgs {
  selectedCountiesSize: number;
  heatmapCountyOn: boolean;
  heatmapStatewideOn: boolean;
  setHeatmapCounty: (on: boolean) => void;
  setHeatmapStatewide: (on: boolean) => void;
}

/**
 * When 3+ counties are selected the per-county heatmap becomes unreadable
 * (point density on top of a multi-county choropleth). This hook auto-turns-off
 * both heatmap layers on the transition from <3 to ≥3 and exposes a
 * dismissable notice for the user.
 *
 * The auto-disable fires once per "too many" episode — tracked via a ref so we
 * don't immediately re-disable when the user manually re-enables the layer.
 * The ref resets when the selection drops back below 3.
 */
export function useAutoDisableHeatmap({
  selectedCountiesSize,
  heatmapCountyOn,
  heatmapStatewideOn,
  setHeatmapCounty,
  setHeatmapStatewide,
}: AutoDisableArgs) {
  const autoDisabledRef = useRef(false);
  const [noteVisible, setNoteVisible] = useState(false);

  useEffect(() => {
    const tooMany = selectedCountiesSize >= 3;
    if (!tooMany) {
      autoDisabledRef.current = false;
      return;
    }
    if (autoDisabledRef.current) return;
    if (!heatmapCountyOn && !heatmapStatewideOn) return;
    autoDisabledRef.current = true;
    setHeatmapCounty(false);
    setHeatmapStatewide(false);
    setNoteVisible(true);
  }, [
    selectedCountiesSize,
    heatmapCountyOn,
    heatmapStatewideOn,
    setHeatmapCounty,
    setHeatmapStatewide,
  ]);

  useEffect(() => {
    if (!noteVisible) return;
    const t = setTimeout(() => setNoteVisible(false), 5000);
    return () => clearTimeout(t);
  }, [noteVisible]);

  return { noteVisible, dismissNote: () => setNoteVisible(false) };
}
