import { useState, useRef, useCallback, useEffect } from "react";
import type { TimelapseSpeed } from "./useTimelapsePlayer";

export type { TimelapseSpeed };

// Same cadence as the Stats time-lapse: 1x = 1 year per 3s, which gives the
// heatmap API time to respond (and the prefetcher time to stay ahead).
export const MS_PER_YEAR_BASE = 3000;

// How many upcoming frames to warm ahead of the playhead.
export const PREFETCH_AHEAD = 2;

interface HeatmapTimelapseOptions {
  minYear: number;
  maxYear: number;
  /**
   * Called with the next `prefetchAhead` years whenever the playhead moves
   * (and when the timelapse first activates), so the caller can
   * `queryClient.prefetchQuery()` upcoming frames. Must be referentially
   * stable (useCallback) — a new identity re-fires the prefetch, which is
   * desired when the surrounding filters change but wasteful otherwise.
   */
  onPrefetch?: (years: number[]) => void;
  prefetchAhead?: number;
  /**
   * When true, `play()` never auto-advances — it only engages the timelapse
   * so the scrubber can be driven manually. Defaults to the system
   * `prefers-reduced-motion` setting; pass `effectiveReducedMotion` from
   * AccessibilityContext where available so the in-app preference wins.
   */
  reducedMotion?: boolean;
}

export interface HeatmapTimelapse {
  /** True while the timelapse overrides the map's year filter. */
  active: boolean;
  currentYear: number;
  isPlaying: boolean;
  speed: TimelapseSpeed;
  reducedMotion: boolean;
  play: () => void;
  pause: () => void;
  seek: (year: number) => void;
  setSpeed: (speed: TimelapseSpeed) => void;
  /** Exit the timelapse: stop playback, deactivate, reset to minYear. */
  stop: () => void;
}

function systemPrefersReducedMotion(): boolean {
  // Guard for test environments (jsdom) that don't ship matchMedia.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * rAF-driven year player for the statewide crash heatmap timelapse.
 *
 * Follows the same rAF discipline as useTimelapsePlayer (delta accumulator,
 * refs mirroring state, cancel on unmount) plus a double-play guard: calling
 * `play()` while a loop is already scheduled is a no-op, so two loops can
 * never race each other at double speed.
 *
 * The animated year is plain component state — it is never written to the
 * URL, so the user's own filters are untouched and simply take effect again
 * when the timelapse deactivates.
 */
export function useHeatmapTimelapse({
  minYear,
  maxYear,
  onPrefetch,
  prefetchAhead = PREFETCH_AHEAD,
  reducedMotion,
}: HeatmapTimelapseOptions): HeatmapTimelapse {
  const reduced = reducedMotion ?? systemPrefersReducedMotion();

  const [active, setActive] = useState(false);
  const [currentYear, setCurrentYear] = useState(minYear);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<TimelapseSpeed>(1);

  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const accumulatorRef = useRef(0);
  const currentYearRef = useRef(currentYear);
  const speedRef = useRef(speed);
  const maxYearRef = useRef(maxYear);
  const reducedRef = useRef(reduced);

  // Keep refs in sync with state/props so the rAF callback stays stable.
  useEffect(() => { currentYearRef.current = currentYear; }, [currentYear]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { maxYearRef.current = maxYear; }, [maxYear]);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);

  const cancelLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback((timestamp: number) => {
    if (lastFrameRef.current === 0) {
      lastFrameRef.current = timestamp;
    }
    const delta = timestamp - lastFrameRef.current;
    lastFrameRef.current = timestamp;

    const msPerYear = MS_PER_YEAR_BASE / speedRef.current;
    accumulatorRef.current += delta;

    if (accumulatorRef.current >= msPerYear) {
      const yearsToAdvance = Math.floor(accumulatorRef.current / msPerYear);
      accumulatorRef.current -= yearsToAdvance * msPerYear;

      const nextYear = currentYearRef.current + yearsToAdvance;
      if (nextYear >= maxYearRef.current) {
        // Land on the final frame and stop the loop, but stay active so the
        // user keeps seeing (and can scrub away from) the last year.
        currentYearRef.current = maxYearRef.current;
        setCurrentYear(maxYearRef.current);
        setIsPlaying(false);
        rafRef.current = null;
        return;
      }
      currentYearRef.current = nextYear;
      setCurrentYear(nextYear);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    setActive(true);
    // Replay support: if the last run finished at the end, start over.
    if (currentYearRef.current >= maxYearRef.current) {
      currentYearRef.current = minYear;
      setCurrentYear(minYear);
    }
    // Reduced motion: engage the timelapse but never auto-advance — the
    // scrubber still works manually.
    if (reducedRef.current) return;
    // Double-play guard: a loop is already scheduled; starting a second one
    // would double the advance rate and leak the first loop.
    if (rafRef.current != null) return;
    lastFrameRef.current = 0;
    accumulatorRef.current = 0;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [minYear, tick]);

  const pause = useCallback(() => {
    cancelLoop();
    setIsPlaying(false);
  }, [cancelLoop]);

  const seek = useCallback((year: number) => {
    const clamped = Math.max(minYear, Math.min(maxYear, Math.round(year)));
    // Manual scrubbing engages the timelapse too (reduced-motion path).
    setActive(true);
    currentYearRef.current = clamped;
    setCurrentYear(clamped);
    accumulatorRef.current = 0;
  }, [minYear, maxYear]);

  const setSpeed = useCallback((s: TimelapseSpeed) => {
    setSpeedState(s);
  }, []);

  const stop = useCallback(() => {
    cancelLoop();
    setIsPlaying(false);
    setActive(false);
    currentYearRef.current = minYear;
    setCurrentYear(minYear);
    accumulatorRef.current = 0;
  }, [cancelLoop, minYear]);

  // Warm the next frames whenever the playhead moves while active. The
  // current frame is fetched by the live query itself; this only looks ahead.
  useEffect(() => {
    if (!active || !onPrefetch) return;
    const ahead: number[] = [];
    for (let i = 1; i <= prefetchAhead; i++) {
      if (currentYear + i <= maxYear) ahead.push(currentYear + i);
    }
    if (ahead.length > 0) onPrefetch(ahead);
  }, [active, currentYear, maxYear, prefetchAhead, onPrefetch]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return { active, currentYear, isPlaying, speed, reducedMotion: reduced, play, pause, seek, setSpeed, stop };
}
