import { useState, useCallback, useEffect, useRef } from "react";
import type { CommandAction } from "../lib/keyboard/commandActions";
import { buildCommandList, filterCommands } from "../lib/keyboard/commandActions";
import type { CommandPaletteCallbacks } from "../lib/keyboard/commandActions";

/**
 * Hook to manage the command palette state and keyboard interaction.
 *
 * Opens with Cmd+K / Ctrl+K. Provides:
 *  - open/close state
 *  - query string
 *  - filtered results
 *  - selected index for arrow key navigation
 *  - execute function
 */

interface UseCommandPaletteOptions {
  callbacks: CommandPaletteCallbacks;
  enabled?: boolean;
}

export function useCommandPalette({ callbacks, enabled = true }: UseCommandPaletteOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Build commands list (stable reference through ref)
  const commands = useRef<CommandAction[]>([]);
  commands.current = buildCommandList(callbacksRef.current);

  const filteredResults = filterCommands(commands.current, query);

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) {
        setQuery("");
        setSelectedIndex(0);
      }
      return !prev;
    });
  }, []);

  const execute = useCallback(
    (action?: CommandAction) => {
      const target = action ?? filteredResults[selectedIndex];
      if (target) {
        close();
        // Execute after close to avoid focus conflicts
        requestAnimationFrame(() => target.action());
      }
    },
    [filteredResults, selectedIndex, close],
  );

  const moveSelection = useCallback(
    (direction: "up" | "down") => {
      setSelectedIndex((prev) => {
        if (direction === "down") {
          return Math.min(prev + 1, filteredResults.length - 1);
        }
        return Math.max(prev - 1, 0);
      });
    },
    [filteredResults.length],
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Global keyboard listener for Cmd+K / Ctrl+K
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Open palette: Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
        return;
      }

      // Close on Escape when open
      if (isOpen && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }

    // Use capture phase to intercept before other handlers
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, isOpen, toggle, close]);

  return {
    isOpen,
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    filteredResults,
    open,
    close,
    toggle,
    execute,
    moveSelection,
  };
}
