import type { Map as LeafletMap } from "leaflet";

interface SearchPillProps {
  map: LeafletMap | null;
}

export default function SearchPill({ map }: SearchPillProps) {
  return (
    <div className="absolute bottom-28 md:bottom-8 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 z-10 flex items-center gap-1 p-1 bg-white dark:bg-neutral-800 rounded-full shadow-lg">
      {/* Search button */}
      <button className="flex items-center gap-2 flex-1 md:flex-none px-6 py-3 bg-primary text-on-primary rounded-full transition-all hover:opacity-90">
        <span className="material-symbols-outlined text-lg">search</span>
        <span className="text-sm font-semibold tracking-tight">
          Search California
        </span>
      </button>

      {/* Divider — hidden on mobile */}
      <div className="hidden md:block w-[1px] h-6 bg-outline-variant/30 mx-2" />

      {/* Location — hidden on mobile */}
      <button
        onClick={() => {
          if (map) map.setView([37.2, -119.5], 6, { animate: true, duration: 0.5 });
        }}
        className="hidden md:block p-3 text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined">my_location</span>
      </button>

      {/* Zoom in — hidden on mobile */}
      <button
        onClick={() => {
          if (map) map.zoomIn(1, { animate: true });
        }}
        className="hidden md:block p-3 text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined">zoom_in</span>
      </button>

      {/* Zoom out — hidden on mobile */}
      <button
        onClick={() => {
          if (map) map.zoomOut(1, { animate: true });
        }}
        className="hidden md:block p-3 text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined">zoom_out</span>
      </button>
    </div>
  );
}
