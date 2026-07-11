import type { TimelapseSpeed } from "../../hooks/useHeatmapTimelapse";
import { isPartialYear } from "../../lib/partialYear";

interface Props {
  active: boolean;
  currentYear: number;
  isPlaying: boolean;
  speed: TimelapseSpeed;
  minYear: number;
  maxYear: number;
  loading?: boolean;
  reducedMotion?: boolean;
  searchOpen?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (year: number) => void;
  onSetSpeed: (speed: TimelapseSpeed) => void;
  onStop: () => void;
}

const SPEEDS: TimelapseSpeed[] = [0.25, 0.5, 0.75, 1];

/**
 * Floating timelapse transport for the statewide heatmap: play/pause, a
 * labeled year scrubber (native range input — keyboard support for free),
 * speed chips, and an exit button. While active it also renders a large
 * year badge overlay (aria-live polite) so the animated year is always
 * visible over the map.
 */
export default function TemporalScrubber({
  active,
  currentYear,
  isPlaying,
  speed,
  minYear,
  maxYear,
  loading,
  reducedMotion,
  searchOpen,
  onPlay,
  onPause,
  onSeek,
  onSetSpeed,
  onStop,
}: Props) {
  return (
    <>
      {/* Year badge overlay — shown while the timelapse drives the heatmap */}
      {active && (
        <div
          data-testid="temporal-year-badge"
          role="status"
          aria-live="polite"
          className="absolute bottom-[6.75rem] left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-xl px-5 py-1.5 flex items-center gap-2"
        >
          <span className="text-2xl md:text-3xl font-headline font-bold text-on-surface tabular-nums tracking-tight">
            {currentYear}
          </span>
          {isPartialYear(currentYear) && (
            <span
              className="text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant"
              aria-hidden="true"
              title={`${currentYear} is partial-year data`}
            >
              partial
            </span>
          )}
          {loading && (
            <span
              className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            />
          )}
          <span className="sr-only">
            {loading ? `Loading crashes for ${currentYear}` : `Showing crashes for ${currentYear}`}
            {isPartialYear(currentYear) ? ` — ${currentYear} is partial-year data` : ""}
          </span>
        </div>
      )}

      <section
        aria-label="Heatmap timelapse"
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-surface-container-lowest/95 backdrop-blur-md ghost-border rounded-xl shadow-lg px-3 py-2 flex items-center gap-2 md:gap-3 w-[calc(100%-1.5rem)] max-w-md ${searchOpen ? "hidden md:flex" : ""}`}
      >
        <button
          type="button"
          onClick={isPlaying ? onPause : onPlay}
          disabled={reducedMotion}
          aria-pressed={isPlaying}
          aria-label={
            reducedMotion
              ? "Auto-play disabled by reduced motion preference"
              : isPlaying
                ? "Pause timelapse"
                : "Play timelapse"
          }
          title={reducedMotion ? "Auto-play is disabled by your reduced-motion preference — drag the year slider instead" : undefined}
          className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>

        <span className="text-[10px] text-on-surface-variant tabular-nums shrink-0">{minYear}</span>
        <input
          type="range"
          min={minYear}
          max={maxYear}
          step={1}
          value={currentYear}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Timelapse year"
          aria-valuetext={String(currentYear)}
          className="flex-1 min-w-0 h-2 rounded-full appearance-none bg-surface-container-highest cursor-pointer accent-primary"
        />
        <span className="text-[10px] text-on-surface-variant tabular-nums shrink-0">{maxYear}</span>

        <div
          role="radiogroup"
          aria-label="Playback speed"
          className="hidden md:flex items-center gap-1 shrink-0"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => onSetSpeed(s)}
              className={`px-1.5 py-1 rounded-full text-[10px] font-medium tabular-nums transition-colors ${
                speed === s
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {active && (
          <button
            type="button"
            onClick={onStop}
            aria-label="Exit timelapse"
            title="Exit timelapse and restore your filters"
            className="p-1.5 rounded-full text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
          </button>
        )}
      </section>
    </>
  );
}
