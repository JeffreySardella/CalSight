import type { TimelapseSpeed } from "../../hooks/useTimelapsePlayer";

interface Props {
  currentYear: number;
  isPlaying: boolean;
  speed: TimelapseSpeed;
  minYear: number;
  maxYear: number;
  loading?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (year: number) => void;
  onSetSpeed: (speed: TimelapseSpeed) => void;
}

const SPEEDS: TimelapseSpeed[] = [0.25, 0.5, 0.75, 1];

export default function TimelapseControls({
  currentYear,
  isPlaying,
  speed,
  minYear,
  maxYear,
  loading,
  onPlay,
  onPause,
  onSeek,
  onSetSpeed,
}: Props) {
  return (
    <section
      className="bg-surface-container-low rounded-lg px-4 md:px-6 py-4 flex flex-col items-center gap-4"
      aria-label="Time-lapse controls"
    >
      {/* Current year display */}
      <span className="text-4xl font-headline font-bold text-on-surface tabular-nums tracking-tight">
        {currentYear}
      </span>

      {/* Transport controls row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onSeek(currentYear - 1)}
          disabled={currentYear <= minYear}
          className="p-2.5 rounded-full text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Previous year"
        >
          <span className="material-symbols-outlined text-[24px]">skip_previous</span>
        </button>

        <button
          type="button"
          disabled={loading && !isPlaying}
          onClick={isPlaying ? onPause : onPlay}
          className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          <span className="material-symbols-outlined text-[28px]">
            {isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSeek(currentYear + 1)}
          disabled={currentYear >= maxYear}
          className="p-2.5 rounded-full text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Next year"
        >
          <span className="material-symbols-outlined text-[24px]">skip_next</span>
        </button>
      </div>

      {/* Year scrubber */}
      <div className="w-full max-w-md flex items-center gap-2 sm:gap-3 px-1">
        <span className="text-[10px] sm:text-xs text-on-surface-variant tabular-nums flex-shrink-0">{minYear}</span>
        <input
          type="range"
          min={minYear}
          max={maxYear}
          step={1}
          value={currentYear}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none bg-surface-container-highest cursor-pointer accent-primary"
          aria-label="Seek year"
        />
        <span className="text-[10px] sm:text-xs text-on-surface-variant tabular-nums flex-shrink-0">{maxYear}</span>
      </div>

      {/* Speed chips */}
      <div className="flex items-center gap-2 flex-wrap justify-center w-full max-w-md" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            onClick={() => onSetSpeed(s)}
            className={`px-4 py-2.5 rounded-full text-xs font-medium transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
              speed === s
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>
    </section>
  );
}
