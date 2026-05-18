import { useState, useRef, useCallback, useEffect } from "react";

export type TimelapseSpeed = 0.25 | 0.5 | 0.75 | 1;

interface TimelapseState {
  currentYear: number;
  isPlaying: boolean;
  speed: TimelapseSpeed;
  play: () => void;
  pause: () => void;
  seek: (year: number) => void;
  setSpeed: (speed: TimelapseSpeed) => void;
  reset: () => void;
}

const MS_PER_YEAR_BASE = 3000; // 1x speed = 1 year per 3s (gives API time to respond)

export function useTimelapsePlayer(minYear: number, maxYear: number): TimelapseState {
  const [currentYear, setCurrentYear] = useState(minYear);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<TimelapseSpeed>(1);

  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const currentYearRef = useRef(currentYear);
  const speedRef = useRef(speed);
  const maxYearRef = useRef(maxYear);

  // Keep refs in sync with state
  useEffect(() => { currentYearRef.current = currentYear; }, [currentYear]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { maxYearRef.current = maxYear; }, [maxYear]);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsPlaying(false);
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
        setCurrentYear(maxYearRef.current);
        setIsPlaying(false);
        rafRef.current = null;
        return;
      }
      setCurrentYear(nextYear);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const play = useCallback(() => {
    // If at max, reset to min before playing
    if (currentYearRef.current >= maxYearRef.current) {
      setCurrentYear(minYear);
      currentYearRef.current = minYear;
    }
    lastFrameRef.current = 0;
    accumulatorRef.current = 0;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [minYear, tick]);

  const pause = useCallback(() => {
    stop();
  }, [stop]);

  const seek = useCallback((year: number) => {
    const clamped = Math.max(minYear, Math.min(maxYear, year));
    setCurrentYear(clamped);
  }, [minYear, maxYear]);

  const setSpeed = useCallback((s: TimelapseSpeed) => {
    setSpeedState(s);
  }, []);

  const reset = useCallback(() => {
    stop();
    setCurrentYear(minYear);
    accumulatorRef.current = 0;
  }, [stop, minYear]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return { currentYear, isPlaying, speed, play, pause, seek, setSpeed, reset };
}
