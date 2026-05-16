import { useEffect } from "react";
import ChartConfigPanel from "./ChartConfigPanel";
import type { Dimension, Measure, ChartType } from "../../lib/dashboard/types";

interface Props {
  open: boolean;
  initial?: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension };
  onConfirm: (config: { dimension: Dimension; measure: Measure; chartType: ChartType; splitBy?: Dimension }) => void;
  onCancel: () => void;
}

export default function ChartConfigSheet({ open, initial, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-safe-bottom">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-outline-variant" />
        <ChartConfigPanel initial={initial} onConfirm={onConfirm} onCancel={onCancel} />
      </div>
    </div>
  );
}
