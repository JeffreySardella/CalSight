import { createContext, useContext, useEffect, useState } from "react";

export type MotionPref = "system" | "on" | "off";
export type TextSize = "sm" | "md" | "lg";

interface AccessibilityContextValue {
  motion: MotionPref;
  setMotion: (m: MotionPref) => void;
  highContrast: boolean;
  setHighContrast: (v: boolean) => void;
  textSize: TextSize;
  setTextSize: (s: TextSize) => void;
  effectiveReducedMotion: boolean;
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

const MOTION_KEY = "calsight-reduced-motion";
const CONTRAST_KEY = "calsight-high-contrast";
const TEXT_SIZE_KEY = "calsight-text-size";

const TEXT_SIZE_PX: Record<TextSize, number> = { sm: 14, md: 16, lg: 18 };

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [motion, setMotionState] = useState<MotionPref>(() => {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored === "on" || stored === "off" || stored === "system") return stored;
    return "system";
  });

  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    return localStorage.getItem(CONTRAST_KEY) === "true";
  });

  const [textSize, setTextSizeState] = useState<TextSize>(() => {
    const stored = localStorage.getItem(TEXT_SIZE_KEY);
    if (stored === "sm" || stored === "md" || stored === "lg") return stored;
    return "md";
  });

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

  useEffect(() => {
    document.documentElement.style.fontSize = `${TEXT_SIZE_PX[textSize]}px`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [textSize]);

  function setMotion(next: MotionPref) {
    localStorage.setItem(MOTION_KEY, next);
    setMotionState(next);
  }

  function setHighContrast(next: boolean) {
    localStorage.setItem(CONTRAST_KEY, String(next));
    setHighContrastState(next);
  }

  function setTextSize(next: TextSize) {
    localStorage.setItem(TEXT_SIZE_KEY, next);
    setTextSizeState(next);
  }

  return (
    <AccessibilityContext.Provider value={{
      motion, setMotion,
      highContrast, setHighContrast,
      textSize, setTextSize,
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
