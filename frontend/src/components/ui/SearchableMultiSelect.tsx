import { useState, useRef, useEffect } from "react";

interface SearchableMultiSelectProps {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  placeholder?: string;
  resetKey?: number;
}

export default function SearchableMultiSelect({
  options,
  selected,
  onToggle,
  placeholder = "Search...",
  resetKey = 0,
}: SearchableMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const filtered = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()),
  );

  const selectedOptions = options.filter((opt) => selected.has(opt.value));

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedOptions.map((opt) => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 bg-primary-container text-on-primary-container px-2.5 py-1 rounded-full text-xs font-medium"
            >
              {opt.label}
              <button
                onClick={() => onToggle(opt.value)}
                className="hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full bg-surface-container-high border-none rounded-lg py-3 pl-10 pr-4 text-sm text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Dropdown list */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/15">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-on-surface-variant">
              No results
            </div>
          ) : (
            filtered.map((opt) => {
              const isSelected = selected.has(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => onToggle(opt.value)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-surface-container transition-colors"
                >
                  <span
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
