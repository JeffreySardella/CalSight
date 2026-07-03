import { useState, useMemo, useRef, useEffect, useId } from "react";

interface SearchableMultiSelectProps {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  placeholder?: string;
  resetKey?: number;
  /** Values in this set won't show an X/dismiss button on their chip. */
  nonDismissableValues?: Set<string>;
}

export default function SearchableMultiSelect({
  options,
  selected,
  onToggle,
  placeholder = "Search...",
  resetKey = 0,
  nonDismissableValues,
}: SearchableMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  // Clear search text when resetKey changes (e.g. Clear All)
  useEffect(() => {
    setQuery("");
  }, [resetKey]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const lowerQuery = query.toLowerCase();
  const filtered = useMemo(
    () => options.filter((opt) => opt.label.toLowerCase().includes(lowerQuery)),
    [options, lowerQuery],
  );

  const selectedOptions = useMemo(
    () => options.filter((opt) => selected.has(opt.value)),
    [options, selected],
  );

  // Keep the active option within range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => (i >= filtered.length ? filtered.length - 1 : i));
  }, [filtered.length]);

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (isOpen && activeIndex >= 0 && activeIndex < filtered.length) {
        e.preventDefault();
        onToggle(filtered[activeIndex].value);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedOptions.map((opt) => {
            const canDismiss = !nonDismissableValues?.has(opt.value);
            return (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 bg-primary-container text-on-primary-container px-2.5 py-1 rounded-full text-xs font-medium"
              >
                {opt.label}
                {canDismiss && (
                  <button
                    type="button"
                    onClick={() => onToggle(opt.value)}
                    className="hover:text-on-surface transition-colors p-0.5 min-w-[24px] min-h-[24px] flex items-center justify-center"
                    aria-label={`Remove ${opt.label}`}
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <span aria-hidden="true" className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
          search
        </span>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full bg-surface-container-high border-none rounded-lg py-3 pl-10 pr-4 text-base md:text-sm text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={placeholder}
          className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/15"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-on-surface-variant">
              No results
            </div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = selected.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  id={optionId(idx)}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onToggle(opt.value)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                    idx === activeIndex ? "bg-surface-container" : "hover:bg-surface-container"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`material-symbols-outlined text-[18px] ${
                      isSelected ? "text-primary" : "text-transparent"
                    }`}
                  >
                    check
                  </span>
                  <span className={isSelected ? "text-on-surface font-medium" : "text-on-surface-variant"}>
                    {opt.label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
