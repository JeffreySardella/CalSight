import { useState, useEffect, useRef, useCallback } from "react";
import type { Map as LeafletMap } from "leaflet";
import { CA_COUNTIES } from "../../hooks/useFilterParams";
import { useNominatim } from "../../hooks/useNominatim";
import { useFavoriteLocations } from "../../hooks/useFavoriteLocations";

interface UnifiedSearchBarProps {
  map: LeafletMap | null;
  onSelectCounty: (name: string) => void;
  onSelectPlace: (lat: number, lng: number) => void;
  onGeolocate: () => void;
  locating?: boolean;
  onSearchOpen?: (open: boolean) => void;
}

const COUNTY_NAMES = (CA_COUNTIES as unknown as string[]).sort();

export default function UnifiedSearchBar({
  map,
  onSelectCounty,
  onSelectPlace,
  onGeolocate,
  locating = false,
  onSearchOpen,
}: UnifiedSearchBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavoriteLocations();

  const trimmed = query.trim().toLowerCase();
  const countyMatches = trimmed
    ? COUNTY_NAMES.filter((n) => n.toLowerCase().includes(trimmed)).slice(0, 4)
    : [];

  const hasCountyMatch = countyMatches.some((c) => c.toLowerCase() === trimmed);
  const { results: nominatimResults, loading: nominatimLoading } = useNominatim(
    query,
    expanded && trimmed.length >= 3 && !hasCountyMatch,
  );

  const showFavorites = expanded && !trimmed && favorites.length > 0;

  const allResults: { type: "county" | "place" | "favorite"; label: string; sub?: string; lat?: number; lng?: number; county?: string | null }[] = [];

  if (showFavorites) {
    for (const f of favorites) {
      allResults.push({ type: "favorite", label: f.name, sub: f.county ?? undefined, lat: f.lat, lng: f.lng, county: f.county });
    }
  }
  for (const c of countyMatches) {
    allResults.push({ type: "county", label: c, sub: "County" });
  }
  for (const r of nominatimResults) {
    const parts = r.display_name.split(", ");
    const label = parts[0];
    const sub = parts.slice(1, 3).join(", ");
    allResults.push({ type: "place", label, sub, lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
  }

  useEffect(() => {
    if (!map) return;
    const collapse = () => { setExpanded(false); setQuery(""); setHighlightIdx(-1); };
    map.on("movestart", collapse);
    return () => { map.off("movestart", collapse); };
  }, [map]);

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
        setQuery("");
        setHighlightIdx(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [query]);

  const handleSelect = useCallback((item: typeof allResults[0]) => {
    if (item.type === "county") {
      onSelectCounty(item.label);
    } else if ((item.type === "place" || item.type === "favorite") && item.lat != null && item.lng != null) {
      onSelectPlace(item.lat, item.lng);
    }
    setExpanded(false);
    setQuery("");
    setHighlightIdx(-1);
  }, [onSelectCounty, onSelectPlace]);

  const handleSaveFavorite = useCallback((item: typeof allResults[0], e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.lat != null && item.lng != null) {
      addFavorite({ name: item.label, lat: item.lat, lng: item.lng, county: item.county ?? null });
    }
  }, [addFavorite]);

  const handleRemoveFavorite = useCallback((item: typeof allResults[0], e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.lat != null && item.lng != null) {
      removeFavorite(item.lat, item.lng);
    }
  }, [removeFavorite]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setExpanded(false);
      setQuery("");
      setHighlightIdx(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (highlightIdx >= 0 && highlightIdx < allResults.length) {
        handleSelect(allResults[highlightIdx]);
      } else if (allResults.length > 0) {
        handleSelect(allResults[0]);
      }
    }
  };

  const close = () => { setExpanded(false); setQuery(""); setHighlightIdx(-1); };

  const iconForType = (type: string) => {
    if (type === "county") return "map";
    if (type === "favorite") return "star";
    return "location_on";
  };

  const renderResults = (isMobile: boolean) => {
    if (!expanded || allResults.length === 0) return null;
    return (
      <div className={`${isMobile ? "mt-1" : "mt-1.5"} bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-2xl shadow-lg overflow-hidden max-h-72 overflow-y-auto`}>
        {showFavorites && (
          <div className="px-4 pt-3 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Favorites</span>
          </div>
        )}
        {countyMatches.length > 0 && trimmed && (
          <div className="px-4 pt-3 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Counties</span>
          </div>
        )}
        {allResults.map((item, idx) => (
          <div key={`${item.type}-${item.label}-${idx}`}>
            {item.type === "place" && idx === countyMatches.length + (showFavorites ? favorites.length : 0) && (
              <div className="px-4 pt-3 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Places {nominatimLoading && <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse ml-1" />}
                </span>
              </div>
            )}
            <button
              onClick={() => handleSelect(item)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                idx === highlightIdx ? "bg-primary-container text-on-primary-container" : "text-on-surface hover:bg-surface-container"
              }`}
            >
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">
                {iconForType(item.type)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{item.label}{item.type === "county" ? " County" : ""}</div>
                {item.sub && <div className="text-[11px] text-on-surface-variant truncate">{item.sub}</div>}
              </div>
              {item.type === "favorite" ? (
                <button
                  onClick={(e) => handleRemoveFavorite(item, e)}
                  className="p-1 hover:bg-surface-container-high rounded-full transition-colors shrink-0 min-w-[24px] min-h-[24px] flex items-center justify-center"
                  aria-label={`Remove ${item.label} from favorites`}
                >
                  <span className="material-symbols-outlined text-[14px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                </button>
              ) : item.type === "place" && item.lat != null ? (
                (() => {
                  const saved = isFavorite(item.lat!, item.lng!);
                  return (
                    <button
                      onClick={(e) => saved ? handleRemoveFavorite(item, e) : handleSaveFavorite(item, e)}
                      className="p-1 hover:bg-surface-container-high rounded-full transition-colors shrink-0 min-w-[24px] min-h-[24px] flex items-center justify-center"
                      aria-label={saved ? `Remove ${item.label} from favorites` : `Save ${item.label} to favorites`}
                    >
                      <span
                        className={`material-symbols-outlined text-[14px] ${saved ? "text-primary" : "text-on-surface-variant"}`}
                        style={saved ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >star</span>
                    </button>
                  );
                })()
              ) : null}
            </button>
          </div>
        ))}
        {trimmed && countyMatches.length === 0 && nominatimResults.length === 0 && !nominatimLoading && trimmed.length >= 3 && (
          <div className="px-4 py-3 text-sm text-on-surface-variant">
            No results for "{query}"
          </div>
        )}
      </div>
    );
  };

  // --- Mobile expanded search ---
  const [mobileExpanded, _setMobileExpanded] = useState(false);
  const setMobileExpanded = (v: boolean) => { _setMobileExpanded(v); onSearchOpen?.(v); };
  const [mobileQuery, setMobileQuery] = useState("");

  useEffect(() => {
    if (!map) return;
    const collapse = () => { setMobileExpanded(false); setMobileQuery(""); };
    map.on("movestart", collapse);
    return () => { map.off("movestart", collapse); };
  }, [map]);

  useEffect(() => {
    if (mobileExpanded && mobileInputRef.current) mobileInputRef.current.focus();
  }, [mobileExpanded]);

  // Sync mobile query into the main query so hooks work
  useEffect(() => {
    if (mobileExpanded) {
      setExpanded(true);
      setQuery(mobileQuery);
    }
  }, [mobileQuery, mobileExpanded]);

  return (
    <>
      {/* ── Mobile: top-right buttons (next to filter) ── */}
      {!mobileExpanded && (
        <div className="absolute top-3 right-16 z-20 md:hidden flex items-center gap-2">
          <button
            onClick={() => setMobileExpanded(true)}
            className="flex items-center justify-center w-11 h-11 bg-surface-container-lowest/90 backdrop-blur-md rounded-full shadow-lg ghost-border text-on-surface"
            aria-label="Search"
          >
            <span className="material-symbols-outlined text-[20px]">search</span>
          </button>
          <button
            onClick={onGeolocate}
            disabled={locating}
            className={`flex items-center justify-center w-11 h-11 bg-surface-container-lowest/90 backdrop-blur-md rounded-full shadow-lg ghost-border text-on-surface-variant ${locating ? "animate-pulse" : ""}`}
            aria-label="My location"
          >
            <span className="material-symbols-outlined text-[20px]">my_location</span>
          </button>
        </div>
      )}

      {/* ── Mobile: expanded search overlay ── */}
      {mobileExpanded && (
        <div className="fixed inset-0 z-[45] bg-surface/95 backdrop-blur-sm md:hidden flex flex-col">
          <div ref={containerRef} className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-4 py-3 bg-surface-container-lowest shadow-lg border-b border-outline-variant/15">
              <span className="material-symbols-outlined text-lg text-on-surface-variant">search</span>
              <input
                ref={mobileInputRef}
                type="text"
                value={mobileQuery}
                onChange={(e) => setMobileQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search counties, places..."
                aria-label="Search counties and places"
                className="flex-1 bg-transparent text-base text-on-surface placeholder:text-on-surface-variant/60 outline-none ring-0 border-none"
              />
              <button
                onClick={() => { setMobileExpanded(false); setMobileQuery(""); close(); }}
                className="p-1 hover:bg-surface-container rounded-full transition-colors"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {renderResults(true)}
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop: top center search bar + bottom controls ── */}
      <div
        ref={!mobileExpanded ? containerRef : undefined}
        className={`hidden md:block absolute top-3 z-20 transition-[width] duration-300 left-1/2 -translate-x-1/2 ${expanded ? "w-96" : "w-auto"}`}
      >
        <div
          role={expanded ? undefined : "button"}
          tabIndex={expanded ? undefined : 0}
          className={`flex items-center gap-2 bg-surface-container-lowest/95 backdrop-blur-md ghost-border shadow-lg transition-colors duration-300 ${
            expanded ? "rounded-2xl px-4 py-2.5" : "rounded-full px-4 py-2.5 cursor-pointer"
          }`}
          onClick={() => !expanded && setExpanded(true)}
          onKeyDown={(e) => { if (!expanded && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setExpanded(true); } }}
          aria-label={expanded ? undefined : "Open search"}
        >
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0">search</span>
          {expanded ? (
            <>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search counties, places, addresses..."
                aria-label="Search counties, places, and addresses"
                className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none border-none"
              />
              {nominatimLoading && (
                <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); close(); }}
                className="p-0.5 rounded-full hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">close</span>
              </button>
            </>
          ) : (
            <span className="text-sm text-on-surface-variant font-medium whitespace-nowrap pr-1">
              Search California
            </span>
          )}
        </div>
        {renderResults(false)}
      </div>

      {/* ── Desktop: bottom controls (location + zoom) ── */}
      <div className="hidden md:flex absolute bottom-6 right-4 z-[35] flex-col items-center gap-1 p-1 bg-white dark:bg-neutral-800 rounded-full shadow-lg">
        <button
          onClick={onGeolocate}
          disabled={locating}
          className={`p-3 text-on-surface-variant hover:text-on-surface transition-colors ${locating ? "animate-pulse" : ""}`}
        >
          <span className="material-symbols-outlined">my_location</span>
        </button>
        <div className="h-[1px] w-6 bg-outline-variant/30" />
        <button
          onClick={() => map?.zoomIn(1, { animate: true })}
          className="p-3 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">zoom_in</span>
        </button>
        <button
          onClick={() => map?.zoomOut(1, { animate: true })}
          className="p-3 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined">zoom_out</span>
        </button>
      </div>
    </>
  );
}
