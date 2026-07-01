import { useState, useCallback, useRef, useEffect } from "react";

/**
 * useDragReorder — Native HTML5 drag-and-drop reorder for dashboard chart cards.
 *
 * Supports:
 * - Drag handles (only the handle initiates drag)
 * - Visual feedback: dragging card gets "ghost" opacity, drop target shows insertion line
 * - Touch support via pointer events (polyfills drag on mobile)
 * - Auto-scroll when dragging near container edges
 * - Accessible live announcements via aria-live region
 */

export interface DragState {
  /** ID of the card currently being dragged, or null */
  dragId: string | null;
  /** Index where the card would be inserted if dropped now */
  overIndex: number | null;
  /** Whether a drag is actively in progress */
  isDragging: boolean;
}

interface UseDragReorderOptions {
  /** Ordered list of item IDs */
  items: string[];
  /** Called when a drag completes with the new order */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Whether drag is enabled (only in editing/advanced mode) */
  enabled: boolean;
}

interface UseDragReorderReturn {
  /** Current drag state for rendering visual feedback */
  dragState: DragState;
  /** Props to spread on the grid container */
  containerProps: {
    ref: React.RefCallback<HTMLElement>;
    "aria-dropeffect": "move" | "none";
  };
  /** Get props for a draggable item */
  getItemProps: (id: string, index: number) => DragItemProps;
  /** Get props for the drag handle within an item */
  getHandleProps: (id: string) => DragHandleProps;
  /** Announcement text for screen readers */
  announcement: string;
}

export interface DragItemProps {
  draggable: boolean;
  "data-drag-id": string;
  "data-drag-index": number;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  "aria-grabbed"?: boolean;
  "aria-roledescription": string;
  style?: React.CSSProperties;
}

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  role: "button";
  tabIndex: number;
  "aria-label": string;
  "aria-roledescription": string;
}

// Auto-scroll threshold in pixels from edge
const SCROLL_EDGE_PX = 60;
const SCROLL_SPEED = 12;

/**
 * Convert an insertion index (0..items.length, as produced by getDropIndex —
 * "insert before item i", with items.length meaning "after the last item")
 * into the final item index the dragged card occupies after the move.
 *
 * When moving down, removing the dragged card first shifts every later item
 * left by one, so the insertion index overshoots the final position by one.
 * A result equal to fromIndex means the drop is a no-op (dropping a card on
 * itself or immediately after itself).
 */
export function insertionIndexToItemIndex(fromIndex: number, insertionIndex: number): number {
  return insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
}

export function useDragReorder({
  items,
  onReorder,
  enabled,
}: UseDragReorderOptions): UseDragReorderReturn {
  const [dragState, setDragState] = useState<DragState>({
    dragId: null,
    overIndex: null,
    isDragging: false,
  });
  const [announcement, setAnnouncement] = useState("");

  const containerRef = useRef<HTMLElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const dragSourceIndex = useRef<number>(-1);
  // Track which handle was activated so we can cancel drags started elsewhere
  const handleActivatedRef = useRef(false);

  // Auto-scroll logic
  const startAutoScroll = useCallback((clientY: number) => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);

    const container = containerRef.current;
    if (!container) return;

    const scrollParent = findScrollParent(container);
    if (!scrollParent) return;

    const rect = scrollParent.getBoundingClientRect();
    const topDist = clientY - rect.top;
    const bottomDist = rect.bottom - clientY;

    let speed = 0;
    if (topDist < SCROLL_EDGE_PX) {
      speed = -SCROLL_SPEED * (1 - topDist / SCROLL_EDGE_PX);
    } else if (bottomDist < SCROLL_EDGE_PX) {
      speed = SCROLL_SPEED * (1 - bottomDist / SCROLL_EDGE_PX);
    }

    if (speed !== 0) {
      const tick = () => {
        scrollParent.scrollTop += speed;
        scrollRafRef.current = requestAnimationFrame(tick);
      };
      scrollRafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => stopAutoScroll();
  }, [stopAutoScroll]);

  // Determine target index from drag position
  const getDropIndex = useCallback((e: React.DragEvent): number => {
    const container = containerRef.current;
    if (!container) return -1;

    const cards = container.querySelectorAll<HTMLElement>("[data-drag-id]");
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const midX = rect.left + rect.width / 2;

      // For grid layouts, consider both axes
      if (e.clientY < midY && e.clientX < rect.right) {
        return i;
      }
      if (e.clientY < rect.bottom && e.clientX < midX) {
        return i;
      }
    }
    return cards.length;
  }, []);

  // Container ref callback
  const setContainerRef = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
  }, []);

  // Item drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, id: string, index: number) => {
    if (!enabled) {
      e.preventDefault();
      return;
    }

    // Only allow drag if handle was activated
    if (!handleActivatedRef.current) {
      e.preventDefault();
      return;
    }

    dragSourceIndex.current = index;

    // Set drag data
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);

    // Create a custom drag image (slight scale down)
    const el = e.currentTarget as HTMLElement;
    if (e.dataTransfer.setDragImage) {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.width = `${el.offsetWidth}px`;
      clone.style.transform = "rotate(2deg) scale(0.95)";
      clone.style.opacity = "0.9";
      clone.style.position = "absolute";
      clone.style.top = "-9999px";
      clone.style.left = "-9999px";
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, el.offsetWidth / 2, 30);
      // Clean up clone after a tick
      requestAnimationFrame(() => document.body.removeChild(clone));
    }

    setDragState({ dragId: id, overIndex: index, isDragging: true });
    setAnnouncement(`Picked up chart at position ${index + 1} of ${items.length}. Use arrow keys or drop to reorder.`);
  }, [enabled, items.length]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDragEnd = useCallback((_e: React.DragEvent) => {
    stopAutoScroll();
    handleActivatedRef.current = false;

    const { dragId, overIndex } = dragState;
    const fromIndex = dragSourceIndex.current;
    // overIndex is an insertion index; onReorder (like the keyboard path)
    // expects the final item index, so convert before dispatching.
    const toIndex = overIndex !== null ? insertionIndexToItemIndex(fromIndex, overIndex) : null;
    if (dragId && toIndex !== null && toIndex !== fromIndex) {
      onReorder(fromIndex, toIndex);
      setAnnouncement(`Dropped chart at position ${toIndex + 1} of ${items.length}.`);
    } else {
      setAnnouncement("Reorder cancelled.");
    }

    setDragState({ dragId: null, overIndex: null, isDragging: false });
    dragSourceIndex.current = -1;
  }, [dragState, onReorder, items.length, stopAutoScroll]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    startAutoScroll(e.clientY);

    const newIndex = getDropIndex(e);
    setDragState((prev) => {
      if (prev.overIndex === newIndex) return prev;
      return { ...prev, overIndex: newIndex };
    });
  }, [getDropIndex, startAutoScroll]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    // Only clear if leaving the container entirely - handled by checking relatedTarget
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
  }, [stopAutoScroll]);

  // Handle activation (pointer down on handle)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handlePointerDown = useCallback((_id: string) => {
    handleActivatedRef.current = true;
  }, []);

  // Keyboard reorder from handle
  const handleKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (!enabled) return;

    const index = items.indexOf(id);
    if (index < 0) return;

    let targetIndex = -1;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      targetIndex = index - 1;
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      targetIndex = index + 1;
    } else if (e.key === "Home") {
      targetIndex = 0;
    } else if (e.key === "End") {
      targetIndex = items.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    if (targetIndex < 0 || targetIndex >= items.length || targetIndex === index) return;

    onReorder(index, targetIndex);
    setAnnouncement(`Moved chart from position ${index + 1} to position ${targetIndex + 1} of ${items.length}.`);

    // Re-focus the handle in the new position after React re-renders
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const newCard = container.querySelector(`[data-drag-id="${id}"] [data-drag-handle]`) as HTMLElement;
      newCard?.focus();
    });
  }, [enabled, items, onReorder]);

  // Build props getters
  const getItemProps = useCallback((id: string, index: number): DragItemProps => {
    const isBeingDragged = dragState.dragId === id;
    return {
      draggable: enabled,
      "data-drag-id": id,
      "data-drag-index": index,
      onDragStart: (e) => handleDragStart(e, id, index),
      onDragEnd: handleDragEnd,
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      "aria-grabbed": enabled ? isBeingDragged : undefined,
      "aria-roledescription": "sortable chart card",
      style: isBeingDragged ? { opacity: 0.4, transform: "scale(0.98)" } : undefined,
    };
  }, [enabled, dragState.dragId, handleDragStart, handleDragEnd, handleDragOver, handleDragEnter, handleDragLeave, handleDrop]);

  const getHandleProps = useCallback((id: string): DragHandleProps => ({
    onPointerDown: () => handlePointerDown(id),
    onKeyDown: (e) => handleKeyDown(e, id),
    role: "button",
    tabIndex: 0,
    "aria-label": "Drag to reorder",
    "aria-roledescription": "drag handle",
  }), [handlePointerDown, handleKeyDown]);

  const containerProps = {
    ref: setContainerRef,
    "aria-dropeffect": (dragState.isDragging ? "move" : "none") as "move" | "none",
  };

  return {
    dragState,
    containerProps,
    getItemProps,
    getHandleProps,
    announcement,
  };
}

// Utility: find the nearest scrollable ancestor
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      style.overflowY === "auto" ||
      style.overflowY === "scroll" ||
      (current === document.documentElement || current === document.body)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return document.documentElement;
}
