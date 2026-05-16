import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SHORTCUTS,
  groupByCategory,
  formatCombo,
  type ShortcutCategory,
  type RemapStore,
  resolveKeys,
} from "../../lib/keyboard/shortcutRegistry";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  remaps: RemapStore;
  onRemap?: (id: string, newCombo: string) => void;
  onResetRemap?: (id: string) => void;
  onResetAll?: () => void;
}

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  palette: "Command Palette",
  general: "General",
  navigation: "Grid Navigation (vi-style)",
  presets: "Dashboard Presets",
  builder: "Builder Mode",
  chart: "Chart Focus (when card selected)",
};

const CATEGORY_ICONS: Record<ShortcutCategory, string> = {
  palette: "terminal",
  general: "settings",
  navigation: "grid_view",
  presets: "dashboard",
  builder: "construction",
  chart: "bar_chart",
};

/**
 * Keyboard Shortcut Cheat Sheet — a full-screen overlay showing all shortcuts.
 *
 * Opened via Shift+? (same pattern as GitHub, Gmail, etc.)
 *
 * Features:
 *  - Grouped by category with icons
 *  - Shows remapped keys (highlighted)
 *  - Optional inline remapping (click a key to remap)
 *  - Screen-reader friendly with proper headings and description lists
 */
export default function ShortcutCheatSheet({
  isOpen,
  onClose,
  remaps,
  onRemap,
  onResetRemap,
  onResetAll,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [remappingId, setRemappingId] = useState<string | null>(null);
  const [capturedKeys, setCapturedKeys] = useState<string[]>([]);

  // Focus trap and escape
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      // If remapping, capture the key combo
      if (remappingId) {
        e.preventDefault();
        e.stopPropagation();

        const parts: string[] = [];
        if (e.metaKey || e.ctrlKey) parts.push("meta");
        if (e.shiftKey) parts.push("shift");
        if (e.altKey) parts.push("alt");

        // Ignore pure modifier presses
        if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) {
          setCapturedKeys(parts);
          return;
        }

        parts.push(e.key.toLowerCase());
        const combo = parts.join("+");

        if (onRemap) {
          onRemap(remappingId, combo);
        }
        setRemappingId(null);
        setCapturedKeys([]);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, remappingId, onRemap, onClose]);

  // Auto-focus dialog
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => dialogRef.current?.focus());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const grouped = groupByCategory(DEFAULT_SHORTCUTS);
  const categoryOrder: ShortcutCategory[] = ["palette", "general", "navigation", "presets", "builder", "chart"];

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        className="relative w-full max-w-3xl max-h-[80vh] bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden focus:outline-none animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">
              keyboard
            </span>
            <h2 className="text-lg font-headline font-bold text-on-surface">Keyboard Shortcuts</h2>
          </div>
          <div className="flex items-center gap-2">
            {onResetAll && Object.keys(remaps).length > 0 && (
              <button
                onClick={onResetAll}
                className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant hover:text-error transition-colors px-2 py-1"
              >
                Reset All
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-surface-container-high text-on-surface-variant transition-colors"
              aria-label="Close shortcuts overlay"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(80vh-120px)] p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {categoryOrder.map((cat) => {
              const shortcuts = grouped[cat];
              if (shortcuts.length === 0) return null;

              return (
                <section key={cat} aria-labelledby={`cat-${cat}`}>
                  <h3
                    id={`cat-${cat}`}
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                      {CATEGORY_ICONS[cat]}
                    </span>
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <dl className="space-y-1.5">
                    {shortcuts.map((s) => {
                      const resolved = resolveKeys(s, remaps);
                      const isRemapped = remaps[s.id] !== undefined;
                      const isCurrentlyRemapping = remappingId === s.id;

                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-between py-1.5 group"
                        >
                          <dt className="text-sm text-on-surface">{s.label}</dt>
                          <dd className="flex items-center gap-1.5">
                            {isCurrentlyRemapping ? (
                              <span className="px-2 py-1 text-[11px] font-mono bg-primary-container text-on-primary-container rounded border border-primary animate-pulse">
                                {capturedKeys.length > 0
                                  ? capturedKeys.map((k) => formatCombo(k)).join("+") + "..."
                                  : "Press keys..."}
                              </span>
                            ) : (
                              <kbd
                                className={`inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-mono rounded border transition-colors ${
                                  isRemapped
                                    ? "bg-tertiary-container/30 text-on-tertiary-container border-tertiary/30"
                                    : "bg-surface-container text-on-surface-variant border-outline-variant/20"
                                }`}
                              >
                                {formatCombo(resolved)}
                              </kbd>
                            )}
                            {onRemap && !isCurrentlyRemapping && (
                              <button
                                onClick={() => { setRemappingId(s.id); setCapturedKeys([]); }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-container-high text-on-surface-variant transition-all"
                                aria-label={`Remap ${s.label}`}
                                title="Click to remap"
                              >
                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span>
                              </button>
                            )}
                            {isRemapped && onResetRemap && !isCurrentlyRemapping && (
                              <button
                                onClick={() => onResetRemap(s.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-container-high text-error/70 transition-all"
                                aria-label={`Reset ${s.label} to default`}
                                title="Reset to default"
                              >
                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">undo</span>
                              </button>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-outline-variant/10 flex items-center justify-between text-[10px] text-on-surface-variant/60">
          <span>Click the edit icon next to any shortcut to remap it</span>
          <span className="flex items-center gap-1">
            Press
            <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">Esc</kbd>
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
