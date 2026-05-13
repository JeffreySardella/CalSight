/**
 * MapSearchBar — top-of-map expanding search bar for county lookup.
 *
 * Mobile: a compact pill anchored to the top of the map that expands into a
 * full-width search field when tapped. Collapses automatically when the map
 * is panned/zoomed.
 *
 * Desktop: a centered pill at the top of the map that stays expanded with a
 * full-width input. Blurs itself when the user pans.
 *
 * The actual search logic (county matching, fly-to, etc.) is handled by the
 * parent via the `onSearch` callback — this component is pure UI.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Map as LeafletMap } from "leaflet";
import { CA_COUNTIES } from "../../hooks/useFilterParams";

interface MapSearchBarProps {
  map: LeafletMap | null;
  /** Called when user confirms a county selection (Enter or tap result). */
  onSelectCounty: (name: string) => void;
}

const COUNTY_NAMES = (CA_COUNTIES as unknown as string[]).sort();

export default function MapSearchBar({ map, onSelectCounty }: MapSearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Collapse when map starts moving
  useEffect(() => {
    if (!map) return;
    const collapse = () => { setExpanded(false); setQuery(""); setResults([]); };
    map.on("movestart", collapse);
    return () => { map.off("movestart", collapse); };
  }, [map]);

  // Filter county names as user types
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = query.toLowerCase();
    setResults(COUNTY_NAMES.filter((n) => n.toLowerCase().includes(q)).slice(0, 6));
  }, [query]);

  // Focus input when expanded
  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
        setQuery("");
        setResults([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const handleSelect = useCallback((name: string) => {
    onSelectCounty(name);
    setExpanded(false);
    setQuery("");
    setResults([]);
  }, [onSelectCounty]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setExpanded(false); setQuery(""); setResults([]); }
    if (e.key === "Enter" && results.length > 0) handleSelect(results[0]);
  };

  return (
    <>
      {/* Desktop only — mobile search is handled by MapPage icon button + overlay */}
      <div
        ref={containerRef}
        className={`
          hidden md:block
          absolute top-3 z-20 transition-all duration-300
          left-1/2 -translate-x-1/2
          ${expanded ? "w-96" : "w-auto"}
        `}
      >
      {/* Search pill / expanded bar */}
      <div
        role={expanded ? undefined : "button"}
        tabIndex={expanded ? undefined : 0}
        className={`
          flex items-center gap-2
          bg-surface-container-lowest/95 backdrop-blur-md
          ghost-border shadow-lg
          transition-all duration-300
          ${expanded ? "rounded-2xl px-4 py-2.5" : "rounded-full px-4 py-2.5 cursor-pointer"}
        `}
        onClick={() => !expanded && setExpanded(true)}
        onKeyDown={(e) => { if (!expanded && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setExpanded(true); } }}
        aria-label={expanded ? undefined : "Open search"}
      >
        <span className="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0">
          search
        </span>

        {expanded ? (
          <>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search counties…"
              className="
                flex-1 bg-transparent text-sm text-on-surface
                placeholder:text-on-surface-variant/60
                outline-none border-none focus:outline-none focus:ring-0
              "
            />
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(false); setQuery(""); setResults([]); }}
              className="p-0.5 rounded-full hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">close</span>
            </button>
          </>
        ) : (
          <span className="text-sm text-on-surface-variant font-medium whitespace-nowrap pr-1">
            Search counties
          </span>
        )}
      </div>

      {/* Results dropdown */}
      {expanded && results.length > 0 && (
        <div className="mt-1.5 bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-2xl shadow-lg overflow-hidden">
          {results.map((name) => (
            <button
              key={name}
              onClick={() => handleSelect(name)}
              className="
                w-full flex items-center gap-3 px-4 py-3
                text-sm text-on-surface text-left
                hover:bg-surface-container transition-colors
                first:pt-3.5 last:pb-3.5
              "
            >
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">location_on</span>
              <span>{name} County</span>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {expanded && query.trim() && results.length === 0 && (
        <div className="mt-1.5 bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-2xl shadow-lg px-4 py-3">
          <p className="text-sm text-on-surface-variant">No counties match "{query}"</p>
        </div>
      )}
      </div>{/* end containerRef div */}
    </>
  );
}
