import { useState, useCallback } from "react";
import { safeGetItem, safeSetItem } from "../lib/safeStorage";
import type { DashboardConfig } from "../lib/dashboard/types";
import { isValidConfig } from "../lib/dashboard/validateConfig";

const STORAGE_KEY = "calsight-saved-dashboards-v1";
const MAX_SAVES = 20;

export type SavedDashboard = {
  id: string;
  name: string;
  config: DashboardConfig;
  savedAt: string; // ISO string
};

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

function isSavedShape(d: unknown): d is SavedDashboard {
  if (!d || typeof d !== "object") return false;
  const e = d as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    typeof e.savedAt === "string" &&
    !!e.config && typeof e.config === "object"
  );
}

function readFromStorage(): SavedDashboard[] {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop garbage entries so list/rename/remove can't choke on them.
    return parsed.filter(isSavedShape);
  } catch {
    return [];
  }
}

function writeToStorage(items: SavedDashboard[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(items));
}

export function useSavedDashboards() {
  const [items, setItems] = useState<SavedDashboard[]>(readFromStorage);

  const sync = useCallback((next: SavedDashboard[]) => {
    setItems(next);
    writeToStorage(next);
  }, []);

  const save = useCallback(
    (name: string, config: DashboardConfig): string | null => {
      const current = readFromStorage();
      if (current.length >= MAX_SAVES) return null;
      const id = generateId();
      const entry: SavedDashboard = {
        id,
        name: name.trim(),
        config,
        savedAt: new Date().toISOString(),
      };
      const next = [entry, ...current];
      sync(next);
      return id;
    },
    [sync],
  );

  const load = useCallback((id: string): DashboardConfig | null => {
    const current = readFromStorage();
    const entry = current.find((d) => d.id === id);
    // Validate before handing back a config from storage — a corrupt or
    // older-schema save would otherwise crash the dashboard on apply (M-F5).
    if (entry && isValidConfig(entry.config)) return entry.config;
    return null;
  }, []);

  const remove = useCallback(
    (id: string) => {
      const current = readFromStorage();
      const next = current.filter((d) => d.id !== id);
      sync(next);
    },
    [sync],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const current = readFromStorage();
      const next = current.map((d) =>
        d.id === id ? { ...d, name: name.trim() } : d,
      );
      sync(next);
    },
    [sync],
  );

  const list = useCallback((): SavedDashboard[] => {
    return [...items].sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
    );
  }, [items]);

  const isFull = items.length >= MAX_SAVES;

  return { save, load, remove, rename, list, isFull };
}
