import { useState, useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

interface SearchPillProps {
  map: LeafletMap | null;
}

export default function SearchPill({ map }: SearchPillProps) {
  const [isMoving, setIsMoving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!map) return;

    const onMoveStart = () => setIsMoving(true);
    const onMoveEnd = () => setIsMoving(false);

    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);

    return () => {
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
    };
  }, [map]);

  // Auto-focus the input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  // Collapse when map starts moving
  useEffect(() => {
    if (isMoving) setIsExpanded(false);
  }, [isMoving]);

  function handleClose() {
    setIsExpanded(false);
    setQuery("");
  }

  return (
    <>
      {/* Mobile: compact pill / expanded search bar */}
      <div
        className={`absolute z-10 md:hidden transition-all duration-300 ${
          isExpanded
            ? "bottom-4 left-4 right-4"
            : "bottom-4 left-4"
        } ${
          isMoving && !isExpanded ? "opacity-60 scale-90" : "opacity-100 scale-100"
        }`}
      >
        {isExpanded ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest rounded-full shadow-lg ghost-border">
            <span className="material-symbols-outlined text-lg text-on-surface-variant">search</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search counties..."
              className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 border-none"
            />
            <button
              onClick={handleClose}
              className="p-1 hover:bg-surface-container rounded-full transition-colors"
            >
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">close</span>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-2 px-4 py-3 bg-primary text-on-primary rounded-full shadow-lg transition-all duration-300 hover:opacity-90"
          >
            <span className="material-symbols-outlined text-lg">search</span>
            <span
              className={`text-sm font-semibold tracking-tight overflow-hidden whitespace-nowrap transition-all duration-300 ${
                isMoving ? "max-w-0 opacity-0" : "max-w-[100px] opacity-100"
              }`}
            >
              Search
            </span>
          </button>
        )}
      </div>

      {/* Desktop: full pill, centered bottom */}
      <div className="hidden md:flex absolute bottom-8 left-1/2 -translate-x-1/2 z-10 items-center gap-1 p-1 bg-white dark:bg-neutral-800 rounded-full shadow-lg">
        <button className="flex items-center gap-2 px-6 py-3 bg-primary text-on-primary rounded-full transition-all hover:opacity-90">
          <span className="material-symbols-outlined text-lg">search</span>
          <span className="text-sm font-semibold tracking-tight">
            Search California
          </span>
        </button>

        <div className="w-[1px] h-6 bg-outline-variant/30 mx-2" />

        <button
          onClick={() => {
            if (map) map.setView([37.2, -119.5], 6, { animate: true, duration: 0.5 });
          }}
          className="p-3 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">my_location</span>
        </button>

        <button
          onClick={() => {
            if (map) map.zoomIn(1, { animate: true });
          }}
          className="p-3 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">zoom_in</span>
        </button>

        <button
          onClick={() => {
            if (map) map.zoomOut(1, { animate: true });
          }}
          className="p-3 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">zoom_out</span>
        </button>
      </div>
    </>
  );
}
