import { useState, useRef, useEffect } from "react";
import type { Dimension, Measure, ChartType, ChartOptions } from "../../lib/dashboard/types";
import { DIMENSION_LABELS, MEASURE_LABELS } from "../../lib/dashboard/types";
import { parseNlq, resolveNlq, SUGGESTIONS } from "../../lib/dashboard/nlqParser";

interface Props {
  onAddChart: (config: { dimension: Dimension; measure: Measure; chartType: ChartType; options?: ChartOptions }) => void;
}

export default function NlqQueryBar({ onAddChart }: Props) {
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const parsed = value.trim() ? parseNlq(value) : null;
  const resolved = parsed ? resolveNlq(parsed) : null;

  const filteredSuggestions = value.trim()
    ? SUGGESTIONS.filter((s) => s.toLowerCase().includes(value.toLowerCase())).slice(0, 5)
    : SUGGESTIONS.slice(0, 5);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function submit(text?: string) {
    const query = text ?? value;
    const result = parseNlq(query);
    const chart = resolveNlq(result);
    if (chart) {
      onAddChart(chart.options && Object.keys(chart.options).length > 0 ? chart : { ...chart, options: undefined });
      setValue("");
      setShowSuggestions(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (selectedIdx >= 0 && filteredSuggestions[selectedIdx]) {
        setValue(filteredSuggestions[selectedIdx]);
        submit(filteredSuggestions[selectedIdx]);
      } else {
        submit();
      }
      setSelectedIdx(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, filteredSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedIdx(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <span className="absolute left-3 text-on-surface-variant/60 material-symbols-outlined text-[18px]" aria-hidden="true">
          search
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={value}
          onChange={(e) => { setValue(e.target.value); setShowSuggestions(true); setSelectedIdx(-1); }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder="Add a chart… try &quot;crashes by hour&quot; or &quot;fatalities by county as scatter&quot;"
          className="w-full pl-9 pr-20 py-2.5 bg-surface-container rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant/50 border border-outline-variant/20 focus:border-primary focus:outline-none transition-colors"
          aria-label="Natural language chart query"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls="nlq-suggestions-listbox"
          aria-activedescendant={selectedIdx >= 0 ? `nlq-option-${selectedIdx}` : undefined}
        />
        {resolved && (
          <button
            type="button"
            onClick={() => submit()}
            className="absolute right-2 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors"
          >
            Add
          </button>
        )}
      </div>

      {parsed && value.trim() && (
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-on-surface-variant">
          <span className="font-medium">Parsing:</span>
          {parsed.dimension && <span className="px-1.5 py-0.5 bg-primary-container/30 rounded">{DIMENSION_LABELS[parsed.dimension]}</span>}
          {parsed.measure && <span className="px-1.5 py-0.5 bg-tertiary-container/30 rounded">{MEASURE_LABELS[parsed.measure]}</span>}
          {parsed.chartType && <span className="px-1.5 py-0.5 bg-secondary-container/30 rounded">{parsed.chartType}</span>}
          <span className={`ml-auto font-semibold ${parsed.confidence === "high" ? "text-primary" : parsed.confidence === "medium" ? "text-tertiary" : "text-error"}`}>
            {parsed.confidence}
          </span>
        </div>
      )}

      {showSuggestions && filteredSuggestions.length > 0 && (
        <ul
          id="nlq-suggestions-listbox"
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/10 py-1 z-50 max-h-52 overflow-y-auto"
        >
          {filteredSuggestions.map((s, i) => (
            <li
              key={s}
              id={`nlq-option-${i}`}
              role="option"
              aria-selected={i === selectedIdx}
              className={`px-4 py-2 text-sm cursor-pointer transition-colors ${
                i === selectedIdx ? "bg-primary-container/30 text-on-surface" : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
              onMouseDown={() => { setValue(s); submit(s); }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
