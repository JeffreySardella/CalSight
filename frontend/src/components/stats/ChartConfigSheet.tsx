import { useEffect, useRef } from "react";
import ChartConfigPanel from "./ChartConfigPanel";
import type { Dimension, Measure, ChartType, ChartOptions } from "../../lib/dashboard/types";

interface Props {
  open: boolean;
  initial?: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension; options?: ChartOptions };
  onConfirm: (config: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension; options?: ChartOptions }) => void;
  onCancel: () => void;
}

export default function ChartConfigSheet({ open, initial, onConfirm, onCancel }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      panelRef.current?.focus();
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={initial ? "Edit chart" : "Add chart"}
      className="fixed inset-0 z-[60] lg:hidden"
    >
      <div className="absolute inset-0 bg-inverse-surface/30" onClick={onCancel} />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-safe-bottom outline-none"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-outline-variant" />
        <ChartConfigPanel initial={initial} onConfirm={onConfirm} onCancel={onCancel} />
      </div>
    </div>
  );
}
