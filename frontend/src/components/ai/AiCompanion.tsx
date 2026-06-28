import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { DataContext } from "../../lib/ai/dataContext";
import { explainContext } from "../../lib/ai/explainContext";
import { useAskAi } from "../../hooks/useAskAi";
import type { ChatMessage } from "../../hooks/useAskAi";
import InlineChart from "../ask/InlineChart";

export function buildDeepDivePrompt(ctx: DataContext): string {
  const parts: string[] = [`Explain this CalSight data point: "${ctx.label}".`];
  if (ctx.value != null) parts.push(`Value: ${ctx.value}.`);
  if (ctx.geography) parts.push(`Area: ${ctx.geography.name}.`);
  const f = ctx.filters;
  if (f.years.length) parts.push(`Years: ${f.years.join(", ")}.`);
  if (f.severities.length) parts.push(`Severities: ${f.severities.join(", ")}.`);
  if (f.counties.length && !ctx.geography) parts.push(`Counties: ${f.counties.join(", ")}.`);
  if (f.alcohol) parts.push("Alcohol-involved only.");
  parts.push("Be concise and avoid claiming causation.");
  return parts.join(" ");
}

type CompanionApi = {
  open: (ctx: DataContext) => void;
  close: () => void;
  current: DataContext | null;
};

const Ctx = createContext<CompanionApi | null>(null);

export function AiCompanionProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<DataContext | null>(null);
  const [askedHere, setAskedHere] = useState(false);
  const { sendMessage, isLoading, error, retry, messages } = useAskAi();

  const open = useCallback((ctx: DataContext) => setCurrent(ctx), []);
  const close = useCallback(() => setCurrent(null), []);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, close]);

  useEffect(() => { setAskedHere(false); }, [current]);

  const api = useMemo<CompanionApi>(() => ({ open, close, current }), [open, close, current]);
  const explanation = current ? explainContext(current) : null;
  const lastAnswer: ChatMessage | undefined =
    [...messages].reverse().find((m) => m.role === "assistant");

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
          <button
            onClick={() => { if (current) { setAskedHere(true); sendMessage(buildDeepDivePrompt(current)); } }}
            disabled={isLoading}
            className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-50"
          >
            {isLoading ? "Thinking…" : "Go deeper with AI"}
          </button>
          {askedHere && (
            <div aria-live="polite" className="mt-3 max-h-[40vh] overflow-y-auto border-t border-outline-variant pt-3">
              {isLoading && <p className="text-xs text-on-surface-variant">Thinking…</p>}
              {error && !isLoading && (
                <p className="text-xs text-error">
                  {error}{" "}
                  <button onClick={retry} className="underline" aria-label="Retry deep dive">Retry</button>
                </p>
              )}
              {!isLoading && !error && lastAnswer && (
                <div className="prose prose-sm dark:prose-invert max-w-none text-on-surface">
                  <ReactMarkdown>{lastAnswer.content}</ReactMarkdown>
                  {lastAnswer.chart && <InlineChart chart={lastAnswer.chart} />}
                </div>
              )}
            </div>
          )}
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
