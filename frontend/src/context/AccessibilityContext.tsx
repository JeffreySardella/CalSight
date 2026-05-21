import { createContext, useContext, useEffect, useState } from "react";
import {
  setPreferences,
  useUserPreferences,
  type MotionPref,
} from "../hooks/useUserPreferences";

export type { MotionPref };

interface AccessibilityContextValue {
  motion: MotionPref;
  setMotion: (m: MotionPref) => void;
  highContrast: boolean;
  setHighContrast: (v: boolean) => void;
  effectiveReducedMotion: boolean;
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const { reducedMotion: motion, highContrast } = useUserPreferences();

  const [systemReducedMotion, setSystemReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setSystemReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const effectiveReducedMotion =
    motion === "on" || (motion === "system" && systemReducedMotion);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", effectiveReducedMotion);
  }, [effectiveReducedMotion]);

  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast);
  }, [highContrast]);

  function setMotion(next: MotionPref) {
    setPreferences({ reducedMotion: next });
  }

  function setHighContrast(next: boolean) {
    setPreferences({ highContrast: next });
  }

  return (
    <AccessibilityContext.Provider value={{
      motion, setMotion,
      highContrast, setHighContrast,
      effectiveReducedMotion,
    }}>
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error("useAccessibility must be used within AccessibilityProvider");
  return ctx;
}
