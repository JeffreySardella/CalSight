import { createContext, useContext, useEffect, useState } from "react";

export type LiteModeSetting = "on" | "off" | "auto";

interface LiteModeContextValue {
  setting: LiteModeSetting;
  setSetting: (s: LiteModeSetting) => void;
  isLite: boolean;
}

const LiteModeContext = createContext<LiteModeContextValue | undefined>(undefined);

const STORAGE_KEY = "calsight-lite-mode";

function detectSlowDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
  if (conn?.saveData) return true;
  if (conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") return true;
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2) return true;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number" && mem <= 2) return true;
  return false;
}

export function LiteModeProvider({ children }: { children: React.ReactNode }) {
  const [setting, setSettingState] = useState<LiteModeSetting>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "on" || stored === "off" || stored === "auto") return stored;
    return "auto";
  });

  const isLite =
    setting === "on" || (setting === "auto" && detectSlowDevice());

  useEffect(() => {
    document.documentElement.classList.toggle("lite-mode", isLite);
  }, [isLite]);

  function setSetting(next: LiteModeSetting) {
    localStorage.setItem(STORAGE_KEY, next);
    setSettingState(next);
  }

  return (
    <LiteModeContext.Provider value={{ setting, setSetting, isLite }}>
      {children}
    </LiteModeContext.Provider>
  );
}

export function useLiteMode() {
  const ctx = useContext(LiteModeContext);
  if (!ctx) throw new Error("useLiteMode must be used within LiteModeProvider");
  return ctx;
}
