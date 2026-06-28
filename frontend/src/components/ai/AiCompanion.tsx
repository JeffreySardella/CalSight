import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DataContext } from "../../lib/ai/dataContext";
import { explainContext } from "../../lib/ai/explainContext";

type CompanionApi = {
  open: (ctx: DataContext) => void;
  close: () => void;
  current: DataContext | null;
};

const Ctx = createContext<CompanionApi | null>(null);

export function AiCompanionProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DataContext | null>(null);

  const open = useCallback((ctx: DataContext) => setCurrent(ctx), []);
  const close = useCallback(() => setCurrent(null), []);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, close]);

  const api = useMemo<CompanionApi>(() => ({ open, close, current }), [open, close, current]);
  const explanation = current ? explainContext(current) : null;

  return (
    <Ctx.Provider value={api}>
      {children}
      {current && explanation && (
        <div
          role="dialog"
          aria-label="AI explanation"
          className="fixed bottom-4 right-4 z-[1000] max-w-sm rounded-xl bg-surface-container-high p-4 shadow-lg ghost-border md:bottom-4 md:right-4"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-on-surface">{explanation.headline}</h2>
            <button onClick={close} aria-label="Close explanation" className="text-on-surface-variant hover:text-on-surface">✕</button>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">{explanation.body}</p>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useAiCompanion(): CompanionApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useAiCompanion must be used inside <AiCompanionProvider>");
  return api;
}
