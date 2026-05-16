import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Vi-style grid navigation for chart cards.
 *
 * Manages a focused index within a responsive grid layout.
 * Computes row/column positions dynamically based on actual DOM layout
 * so that h/j/k/l move correctly regardless of breakpoint (1, 2, or 3 cols).
 */

interface UseGridNavigationOptions {
  /** Total number of chart items */
  itemCount: number;
  /** CSS selector for chart card elements */
  cardSelector?: string;
  /** Whether vi navigation is active (disabled when palette/input is open) */
  enabled?: boolean;
  /** Callback when a chart gains focus */
  onFocusChange?: (index: number | null) => void;
}

interface GridPosition {
  row: number;
  col: number;
}

/**
 * Compute the grid column count from actual DOM layout.
 * Examines the first few cards to determine how many fit per row.
 */
function detectColumns(selector: string): number {
  const cards = document.querySelectorAll(selector);
  if (cards.length < 2) return 1;

  const firstTop = (cards[0] as HTMLElement).getBoundingClientRect().top;
  let cols = 1;
  for (let i = 1; i < cards.length; i++) {
    const top = (cards[i] as HTMLElement).getBoundingClientRect().top;
    if (Math.abs(top - firstTop) < 5) {
      cols++;
    } else {
      break;
    }
  }
  return cols;
}

function indexToPosition(index: number, cols: number): GridPosition {
  return { row: Math.floor(index / cols), col: index % cols };
}

function positionToIndex(pos: GridPosition, cols: number, total: number): number {
  const idx = pos.row * cols + pos.col;
  return Math.max(0, Math.min(idx, total - 1));
}

export function useGridNavigation({
  itemCount,
  cardSelector = "[data-chart-id]",
  enabled = true,
  onFocusChange,
}: UseGridNavigationOptions) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;

  // Sync focus to DOM
  useEffect(() => {
    if (focusedIndex === null) return;
    const cards = document.querySelectorAll(cardSelector);
    const card = cards[focusedIndex] as HTMLElement | undefined;
    if (card) {
      card.focus({ preventScroll: false });
      // Scroll into view if needed
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusedIndex, cardSelector]);

  // Notify parent of focus changes
  useEffect(() => {
    onFocusChange?.(focusedIndex);
  }, [focusedIndex, onFocusChange]);

  const moveFocus = useCallback(
    (direction: "h" | "j" | "k" | "l" | "first" | "last") => {
      if (itemCount === 0) return;

      const cols = detectColumns(cardSelector);
      const current = focusedRef.current ?? 0;
      const pos = indexToPosition(current, cols);

      let nextIndex: number;

      switch (direction) {
        case "h": // left
          nextIndex = positionToIndex({ ...pos, col: Math.max(0, pos.col - 1) }, cols, itemCount);
          break;
        case "l": // right
          nextIndex = positionToIndex({ ...pos, col: pos.col + 1 }, cols, itemCount);
          break;
        case "k": // up
          nextIndex = positionToIndex({ ...pos, row: Math.max(0, pos.row - 1) }, cols, itemCount);
          break;
        case "j": // down
          nextIndex = positionToIndex({ ...pos, row: pos.row + 1 }, cols, itemCount);
          break;
        case "first":
          nextIndex = 0;
          break;
        case "last":
          nextIndex = itemCount - 1;
          break;
        default:
          return;
      }

      // Clamp
      nextIndex = Math.max(0, Math.min(nextIndex, itemCount - 1));
      setFocusedIndex(nextIndex);
    },
    [itemCount, cardSelector],
  );

  const clearFocus = useCallback(() => {
    setFocusedIndex(null);
  }, []);

  const setFocus = useCallback(
    (index: number) => {
      if (index >= 0 && index < itemCount) {
        setFocusedIndex(index);
      }
    },
    [itemCount],
  );

  // Listen for vi keys at document level
  useEffect(() => {
    if (!enabled) return;

    function isInputFocused(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      // Check if inside a dialog/modal
      if (el.closest("[role='dialog']")) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isInputFocused()) return;

      // Only handle when no meta/ctrl modifiers (except shift for G)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "h":
          e.preventDefault();
          moveFocus("h");
          break;
        case "j":
          e.preventDefault();
          moveFocus("j");
          break;
        case "k":
          e.preventDefault();
          moveFocus("k");
          break;
        case "l":
          e.preventDefault();
          moveFocus("l");
          break;
        case "g":
          if (!e.shiftKey) {
            e.preventDefault();
            moveFocus("first");
          }
          break;
        case "G":
          e.preventDefault();
          moveFocus("last");
          break;
        default:
          return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, moveFocus]);

  return {
    focusedIndex,
    moveFocus,
    clearFocus,
    setFocus,
  };
}
