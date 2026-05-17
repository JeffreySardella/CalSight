import { useState, useEffect, useRef } from "react";

/**
 * Returns a debounced version of `value` that only updates after `delay` ms
 * of inactivity. Useful for avoiding rapid-fire API calls during animations
 * (e.g., time-lapse playback).
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Returns a throttled version of `value` that updates at most once per
 * `interval` ms. Unlike debounce, it fires periodically during continuous
 * changes (so charts still update during playback) but limits the rate.
 * Also fires immediately when the value first changes after being idle.
 */
export function useThrottledValue<T>(value: T, interval: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdate = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdate.current;

    if (elapsed >= interval) {
      // Enough time has passed — update immediately
      lastUpdate.current = now;
      setThrottled(value);
    } else {
      // Schedule an update for when the interval completes
      if (pendingTimer.current != null) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        lastUpdate.current = Date.now();
        setThrottled(value);
        pendingTimer.current = null;
      }, interval - elapsed);
    }

    return () => {
      if (pendingTimer.current != null) clearTimeout(pendingTimer.current);
    };
  }, [value, interval]);

  return throttled;
}
