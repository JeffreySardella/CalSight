export default function SearchPill() {
  return (
    <div className="absolute bottom-20 md:bottom-8 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 z-10 flex items-center gap-1 p-1 bg-surface-container-lowest/90 backdrop-blur-md rounded-full ambient-shadow ghost-border">
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
      <button className="hidden md:block p-3 text-on-surface-variant hover:text-on-surface transition-colors">
        <span className="material-symbols-outlined">my_location</span>
      </button>

      {/* Zoom in — hidden on mobile */}
      <button className="hidden md:block p-3 text-on-surface-variant hover:text-on-surface transition-colors">
        <span className="material-symbols-outlined">zoom_in</span>
      </button>

      {/* Zoom out — hidden on mobile */}
      <button className="hidden md:block p-3 text-on-surface-variant hover:text-on-surface transition-colors">
        <span className="material-symbols-outlined">zoom_out</span>
      </button>
    </div>
  );
}
