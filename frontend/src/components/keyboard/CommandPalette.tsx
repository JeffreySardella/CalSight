import { useEffect, useRef } from "react";
import type { CommandAction } from "../../lib/keyboard/commandActions";

interface Props {
  isOpen: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  results: CommandAction[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onExecute: (action?: CommandAction) => void;
  onMoveSelection: (dir: "up" | "down") => void;
  onClose: () => void;
}

/**
 * Command Palette — a Spotlight/VS Code-style overlay for quick actions.
 *
 * Accessibility:
 *  - role="dialog" with aria-modal
 *  - Input has aria-autocomplete="list" and aria-activedescendant
 *  - Results use role="listbox" with role="option"
 *  - Focus is trapped inside while open
 *  - Escape closes
 */
export default function CommandPalette({
  isOpen,
  query,
  onQueryChange,
  results,
  selectedIndex,
  onSelect,
  onExecute,
  onMoveSelection,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        onMoveSelection("down");
        break;
      case "ArrowUp":
        e.preventDefault();
        onMoveSelection("up");
        break;
      case "Enter":
        e.preventDefault();
        onExecute();
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Tab":
        // Trap focus inside palette
        e.preventDefault();
        break;
    }
  }

  const activeDescendant = results.length > 0 ? `cmd-option-${selectedIndex}` : undefined;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      role="presentation"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      {/* Palette container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg mx-4 bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center px-4 border-b border-outline-variant/10">
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant mr-3" aria-hidden="true">
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 py-4 bg-transparent text-on-surface text-sm placeholder:text-on-surface-variant/50 focus:outline-none"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-controls="cmd-palette-list"
            aria-activedescendant={activeDescendant}
            role="combobox"
            aria-expanded={results.length > 0}
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-mono text-on-surface-variant bg-surface-container rounded border border-outline-variant/20">
            Esc
          </kbd>
        </div>

        {/* Results */}
        {results.length > 0 ? (
          <ul
            ref={listRef}
            id="cmd-palette-list"
            role="listbox"
            aria-label="Command results"
            className="max-h-[320px] overflow-y-auto py-2"
          >
            {results.map((cmd, i) => (
              <li
                key={cmd.id}
                id={`cmd-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  i === selectedIndex
                    ? "bg-primary-container/30 text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
                onClick={() => onExecute(cmd)}
                onMouseEnter={() => onSelect(i)}
              >
                {cmd.icon && (
                  <span
                    className={`material-symbols-outlined text-[18px] flex-shrink-0 ${
                      i === selectedIndex ? "text-primary" : "text-on-surface-variant"
                    }`}
                    aria-hidden="true"
                  >
                    {cmd.icon}
                  </span>
                )}
                <span className="flex-1 text-sm truncate">{cmd.label}</span>
                <span className="text-[10px] text-on-surface-variant/60 uppercase tracking-wider flex-shrink-0">
                  {cmd.category}
                </span>
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <div className="px-4 py-8 text-center text-on-surface-variant text-sm">
            No commands found for "{query}"
          </div>
        ) : null}

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-outline-variant/10 text-[10px] text-on-surface-variant/60">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface-container rounded border border-outline-variant/20 font-mono">esc</kbd>
              close
            </span>
          </div>
          <span className="uppercase tracking-wider font-medium">Command Palette</span>
        </div>
      </div>
    </div>
  );
}
