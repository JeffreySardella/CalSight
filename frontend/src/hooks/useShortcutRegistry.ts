import { useState, useCallback, useMemo } from "react";
import {
  DEFAULT_SHORTCUTS,
  loadRemaps,
  saveRemaps,
  resolveKeys,
  type ShortcutDef,
  type RemapStore,
} from "../lib/keyboard/shortcutRegistry";

/**
 * Hook to manage the shortcut registry with user remapping support.
 *
 * Provides:
 *  - shortcuts: the full list of shortcut definitions
 *  - getKeys(id): resolved key combo (with remaps applied)
 *  - remap(id, newCombo): save a user remap
 *  - resetAll(): clear all remaps back to defaults
 *  - remaps: the current remap store (for UI display)
 */
export function useShortcutRegistry() {
  const [remaps, setRemaps] = useState<RemapStore>(loadRemaps);

  const getKeys = useCallback(
    (id: string): string => {
      const def = DEFAULT_SHORTCUTS.find((s) => s.id === id);
      if (!def) return "";
      return resolveKeys(def, remaps);
    },
    [remaps],
  );

  const remap = useCallback((id: string, newCombo: string) => {
    setRemaps((prev) => {
      const next = { ...prev, [id]: newCombo };
      saveRemaps(next);
      return next;
    });
  }, []);

  const resetRemap = useCallback((id: string) => {
    setRemaps((prev) => {
      const next = { ...prev };
      delete next[id];
      saveRemaps(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setRemaps({});
    saveRemaps({});
  }, []);

  // Resolved shortcuts (with remaps applied)
  const resolvedShortcuts = useMemo<(ShortcutDef & { resolvedKeys: string })[]>(
    () =>
      DEFAULT_SHORTCUTS.map((s) => ({
        ...s,
        resolvedKeys: resolveKeys(s, remaps),
      })),
    [remaps],
  );

  return {
    shortcuts: DEFAULT_SHORTCUTS,
    resolvedShortcuts,
    remaps,
    getKeys,
    remap,
    resetRemap,
    resetAll,
  };
}
