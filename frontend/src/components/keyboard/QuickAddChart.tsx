import { useState, useEffect, useRef } from "react";
import type { Dimension, Measure, ChartType } from "../../lib/dashboard/types";
import { DIMENSIONS, MEASURES, DIMENSION_LABELS, MEASURE_LABELS } from "../../lib/dashboard/types";

type Step = "dimension" | "measure" | "chartType";

const CHART_TYPES: { value: ChartType; label: string; icon: string }[] = [
  { value: "bar", label: "Bar", icon: "bar_chart" },
  { value: "hbar", label: "Horizontal Bar", icon: "align_horizontal_left" },
  { value: "line", label: "Line", icon: "show_chart" },
  { value: "area", label: "Area", icon: "area_chart" },
  { value: "donut", label: "Donut", icon: "donut_large" },
  { value: "treemap", label: "Treemap", icon: "grid_view" },
  { value: "radar", label: "Radar", icon: "radar" },
  { value: "polar", label: "Polar", icon: "radio_button_unchecked" },
  { value: "lollipop", label: "Lollipop", icon: "more_vert" },
  { value: "scatter", label: "Scatter", icon: "scatter_plot" },
  { value: "gauge", label: "Gauge", icon: "speed" },
  { value: "stat", label: "Stat Card", icon: "pin" },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (config: { dimension: Dimension; measure: Measure; chartType: ChartType }) => void;
}

/**
 * Quick Add Chart — a keyboard-driven stepped picker.
 *
 * Opened via Cmd+N. Flow:
 *  1. Pick dimension (with filtering via typing)
 *  2. Pick measure
 *  3. Pick chart type
 *  4. Done — chart is added
 *
 * Fully keyboard-navigable: type to filter, arrows to select, Enter to confirm.
 */
export default function QuickAddChart({ isOpen, onClose, onAdd }: Props) {
  const [step, setStep] = useState<Step>("dimension");
  const [dimension, setDimension] = useState<Dimension | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setStep("dimension");
      setDimension(null);
      setMeasure(null);
      setFilter("");
      setSelectedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Reset filter/selection when step changes
  useEffect(() => {
    setFilter("");
    setSelectedIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [step]);

  if (!isOpen) return null;

  // Build options based on current step
  let options: { value: string; label: string; icon?: string }[] = [];
  switch (step) {
    case "dimension":
      options = DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABELS[d] }));
      break;
    case "measure":
      options = MEASURES.map((m) => ({ value: m, label: MEASURE_LABELS[m] }));
      break;
    case "chartType":
      options = CHART_TYPES.map((ct) => ({ value: ct.value, label: ct.label, icon: ct.icon }));
      break;
  }

  const filtered = filter.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()))
    : options;

  function confirm(value: string) {
    switch (step) {
      case "dimension":
        setDimension(value as Dimension);
        setStep("measure");
        break;
      case "measure":
        setMeasure(value as Measure);
        setStep("chartType");
        break;
      case "chartType":
        if (dimension && measure) {
          onAdd({ dimension, measure, chartType: value as ChartType });
          onClose();
        }
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIdx]) {
          confirm(filtered[selectedIdx].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        if (step === "measure") {
          setStep("dimension");
        } else if (step === "chartType") {
          setStep("measure");
        } else {
          onClose();
        }
        break;
      case "Backspace":
        if (filter === "") {
          // Go back a step
          if (step === "measure") setStep("dimension");
          else if (step === "chartType") setStep("measure");
        }
        break;
    }
  }

  const stepLabels: Record<Step, string> = {
    dimension: "Pick a dimension",
    measure: "Pick a measure",
    chartType: "Pick a chart type",
  };

  const breadcrumb = [
    dimension ? DIMENSION_LABELS[dimension] : null,
    measure ? MEASURE_LABELS[measure] : null,
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick add chart"
        className="relative w-full max-w-md mx-4 bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Progress */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-2">
            {(["dimension", "measure", "chartType"] as Step[]).map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= ["dimension", "measure", "chartType"].indexOf(step)
                    ? "bg-primary"
                    : "bg-surface-container-high"
                }`}
              />
            ))}
          </div>
          {breadcrumb.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant mb-1">
              {breadcrumb.map((b, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden="true">/</span>}
                  <span className="px-1.5 py-0.5 bg-primary-container/30 rounded font-medium">{b}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex items-center px-4 border-b border-outline-variant/10">
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant mr-3" aria-hidden="true">
            {step === "dimension" ? "category" : step === "measure" ? "analytics" : "bar_chart"}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={stepLabels[step]}
            className="flex-1 py-3 bg-transparent text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:outline-none"
            aria-label={stepLabels[step]}
            aria-autocomplete="list"
            role="combobox"
            aria-expanded={true}
            aria-controls="quick-add-list"
          />
          <span className="text-[10px] text-on-surface-variant/50 uppercase tracking-wider">
            Step {["dimension", "measure", "chartType"].indexOf(step) + 1}/3
          </span>
        </div>

        {/* Options */}
        <ul
          ref={listRef}
          id="quick-add-list"
          role="listbox"
          className="max-h-[260px] overflow-y-auto py-2"
        >
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={i === selectedIdx}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                i === selectedIdx
                  ? "bg-primary-container/30 text-on-surface"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
              onClick={() => confirm(opt.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(opt.value); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              {opt.icon && (
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  {opt.icon}
                </span>
              )}
              <span className="text-sm">{opt.label}</span>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-on-surface-variant text-sm">
              No matches for "{filter}"
            </li>
          )}
        </ul>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-outline-variant/10 text-[10px] text-on-surface-variant/60">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">⌫</kbd>
              back
            </span>
          </div>
          <span className="uppercase tracking-wider font-medium">Quick Add</span>
        </div>
      </div>
    </div>
  );
}
