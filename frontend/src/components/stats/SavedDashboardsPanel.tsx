import { useState, useRef, useEffect, useCallback } from "react";
import type { DashboardConfig } from "../../lib/dashboard/types";
import { useSavedDashboards } from "../../hooks/useSavedDashboards";

type Props = {
  currentConfig: DashboardConfig;
  onLoad: (config: DashboardConfig) => void;
};

export default function SavedDashboardsPanel({ currentConfig, onLoad }: Props) {
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { save, load, remove, list, isFull } = useSavedDashboards();

  const items = list();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSave = useCallback(() => {
    const trimmed = saveName.trim();
    if (!trimmed) {
      setSaveError("Name is required.");
      return;
    }
    if (isFull) {
      setSaveError("Maximum 20 saved dashboards reached. Delete one first.");
      return;
    }
    const id = save(trimmed, currentConfig);
    if (!id) {
      setSaveError("Maximum 20 saved dashboards reached. Delete one first.");
      return;
    }
    setSaveName("");
    setSaveError(null);
    setFlashId(id);
    setTimeout(() => setFlashId(null), 1500);
  }, [saveName, currentConfig, save, isFull]);

  const handleLoad = useCallback(
    (id: string) => {
      const config = load(id);
      if (config) {
        onLoad(config);
        setOpen(false);
      }
    },
    [load, onLoad],
  );

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-on-surface-variant text-[11px] font-medium uppercase tracking-wider hover:text-on-surface transition-colors min-h-[44px] py-2"
        aria-label="Saved dashboards"
        title="Saved dashboards"
      >
        <span className="material-symbols-outlined text-[16px]">
          {open ? "bookmark" : "bookmark_border"}
        </span>
        Saved
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-surface-container-lowest rounded-xl ambient-shadow border border-outline-variant/15 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Save current */}
          <div className="p-3 border-b border-outline-variant/10">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-on-surface-variant mb-2">
              Save current layout
            </p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={saveName}
                onChange={(e) => {
                  setSaveName(e.target.value);
                  setSaveError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                placeholder="Dashboard name..."
                className="flex-1 rounded-md bg-surface-container-high px-2.5 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant/50 outline-none focus:ring-1 focus:ring-primary/50"
                maxLength={50}
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={isFull && saveName.trim().length > 0}
                className="px-3 py-1.5 rounded-md bg-primary text-on-primary text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {saveError && (
              <p className="text-error text-[10px] mt-1.5">{saveError}</p>
            )}
            {isFull && !saveError && (
              <p className="text-amber-600 dark:text-amber-400 text-[10px] mt-1.5">
                20/20 slots used. Delete a dashboard to save a new one.
              </p>
            )}
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-on-surface-variant text-xs text-center py-6 italic">
                No saved dashboards yet.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant/10">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-center justify-between px-3 py-2.5 transition-colors ${
                      flashId === item.id
                        ? "bg-primary/10"
                        : "hover:bg-surface-container-high"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-on-surface truncate">
                        {item.name}
                      </p>
                      <p className="text-[10px] text-on-surface-variant">
                        {formatDate(item.savedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoad(item.id)}
                        className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
                        title="Load this dashboard"
                        aria-label={`Load ${item.name}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          open_in_new
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(item.id)}
                        className="p-1 rounded hover:bg-error/10 text-on-surface-variant hover:text-error transition-colors"
                        title="Delete this dashboard"
                        aria-label={`Delete ${item.name}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          delete
                        </span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
