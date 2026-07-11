import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ToastContext,
  type ToastOptions,
  type ToastVariant,
} from "./toastContext";

/**
 * In-house toast system (#256/#293) — no dependency.
 *
 * - polite aria-live region, so screen readers announce without interrupting
 * - auto-dismiss with pause-on-hover (and pause while focus is inside)
 * - at most 3 stacked; older toasts are dropped first
 * - design-token styling, safe-area aware (sits above the mobile tab bar)
 */

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
}

interface TimerEntry {
  timer: number | null;
  expiresAt: number;
  /** ms left when paused; null while the timer is running. */
  remaining: number | null;
}

const MAX_TOASTS = 3;
const DEFAULT_DURATION = 4000;
/** Give at least this long after un-hovering before a toast disappears. */
const MIN_RESUME_MS = 500;

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: "check_circle",
  error: "error",
  info: "info",
};

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, TimerEntry>());
  const pausedRef = useRef(false);

  const clearTimer = useCallback((id: number) => {
    const entry = timersRef.current.get(id);
    if (entry?.timer != null) window.clearTimeout(entry.timer);
    timersRef.current.delete(id);
  }, []);

  const dismissToast = useCallback((id: number) => {
    clearTimer(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, [clearTimer]);

  const schedule = useCallback((id: number, ms: number) => {
    const timer = window.setTimeout(() => dismissToast(id), ms);
    timersRef.current.set(id, { timer, expiresAt: Date.now() + ms, remaining: null });
  }, [dismissToast]);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    const id = ++idRef.current;
    const item: ToastItem = {
      id,
      message,
      variant: options?.variant ?? "info",
      duration: options?.duration ?? DEFAULT_DURATION,
    };
    setToasts((prev) => {
      const next = [...prev, item];
      // Cap the stack at 3 — drop (and un-time) the oldest.
      for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
        clearTimer(dropped.id);
      }
      return next.slice(-MAX_TOASTS);
    });
    if (pausedRef.current) {
      // Arrived while hovered — hold it until the pointer leaves.
      timersRef.current.set(id, { timer: null, expiresAt: 0, remaining: item.duration });
    } else {
      schedule(id, item.duration);
    }
    return id;
  }, [clearTimer, schedule]);

  const pauseAll = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    for (const entry of timersRef.current.values()) {
      if (entry.timer != null) {
        window.clearTimeout(entry.timer);
        entry.timer = null;
        entry.remaining = Math.max(MIN_RESUME_MS, entry.expiresAt - Date.now());
      }
    }
  }, []);

  const resumeAll = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    for (const [id, entry] of timersRef.current) {
      if (entry.timer == null) {
        schedule(id, entry.remaining ?? DEFAULT_DURATION);
      }
    }
  }, [schedule]);

  // Clear any outstanding timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const entry of timers.values()) {
        if (entry.timer != null) window.clearTimeout(entry.timer);
      }
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        data-testid="toast-viewport"
        onMouseEnter={pauseAll}
        onMouseLeave={resumeAll}
        onFocus={pauseAll}
        onBlur={resumeAll}
        className="fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none w-[calc(100%-2rem)] max-w-sm bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto w-full flex items-center gap-2.5 bg-surface-container-lowest/95 backdrop-blur-md ghost-border ambient-shadow rounded-xl px-4 py-3"
          >
            <span
              className={`material-symbols-outlined text-[18px] shrink-0 ${
                t.variant === "error"
                  ? "text-error"
                  : t.variant === "success"
                    ? "text-primary"
                    : "text-on-surface-variant"
              }`}
              aria-hidden="true"
            >
              {VARIANT_ICON[t.variant]}
            </span>
            <p className="flex-1 text-xs font-medium text-on-surface leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 p-1 -mr-1 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
