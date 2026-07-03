import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { DataContext } from "../../lib/ai/dataContext";
import { explainContext } from "../../lib/ai/explainContext";
import { useAskAi } from "../../hooks/useAskAi";
import type { ChatMessage } from "../../hooks/useAskAi";
import InlineChart from "../ask/InlineChart";
import { useDistribution } from "../../hooks/useDistribution";
import { measureToMetric, filtersToDistributionParams } from "../../lib/ai/measureMetric";

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
  const { sendMessage, isLoading, error, retry, messages, cooldownEnd } = useAskAi();

  // Mirror the Ask AI page: tick down the send cooldown so "Go deeper" is
  // disabled while the server backoff (or the local per-question cooldown)
  // is still active.
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  useEffect(() => {
    const update = () => setCooldownRemaining(Math.max(0, Math.ceil(((cooldownEnd || 0) - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [cooldownEnd]);

  const open = useCallback((ctx: DataContext) => setCurrent(ctx), []);
  const close = useCallback(() => setCurrent(null), []);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, close]);

  // Focus management: trap focus inside the dialog while open, and restore it
  // to whatever was focused when it opened (usually the "Explain" trigger).
  // The Tab trap is a native listener on the dialog node (rather than a JSX
  // onKeyDown) so it doesn't trip jsx-a11y's non-interactive-element rule.
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!current) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener("keydown", onTab);
    return () => {
      dialog?.removeEventListener("keydown", onTab);
      restoreFocusRef.current?.focus?.();
    };
  }, [current]);

  useEffect(() => { setAskedHere(false); }, [current]);

  const api = useMemo<CompanionApi>(() => ({ open, close, current }), [open, close, current]);

  const metric = current?.kind === "stat" ? measureToMetric(current.measure ?? "") : null;
  const years = current?.filters.years ?? [];
  // Distribution is gated on a single-county, single-year stat. Population-
  // narrowing filters (severity, cause, alcohol, …) no longer disable it — they
  // are forwarded so the per-county distribution reflects the same population,
  // keeping the percentile honest under any filter combination.
  const distEnabled =
    current?.kind === "stat" &&
    current.geography?.type === "county" &&
    metric != null &&
    years.length <= 1;
  const distYear = years.length === 1 ? years[0] : null;
  const distFilterParams = useMemo(
    () => (current ? filtersToDistributionParams(current.filters) : {}),
    [current],
  );
  const { data: distribution } = useDistribution(metric ?? "crash_count", distYear, {
    enabled: distEnabled,
    filterParams: distFilterParams,
  });

  const explanation = current
    ? explainContext(current, distEnabled ? { distribution } : undefined)
    : null;
  const lastAnswer: ChatMessage | undefined =
    [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <Ctx.Provider value={api}>
      {children}
      {current && explanation && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="AI explanation"
          tabIndex={-1}
          className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[1000] max-w-sm rounded-xl bg-surface-container-high p-4 shadow-lg ghost-border lg:bottom-4 lg:left-auto focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-on-surface">{explanation.headline}</h2>
            <button onClick={close} aria-label="Close explanation" className="text-on-surface-variant hover:text-on-surface">✕</button>
          </div>
          <p className="mt-2 text-sm text-on-surface-variant">{explanation.body}</p>
          <button
            onClick={() => {
              if (current && !isLoading && cooldownRemaining === 0) {
                setAskedHere(true);
                sendMessage(buildDeepDivePrompt(current));
              }
            }}
            disabled={isLoading || cooldownRemaining > 0}
            className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-50"
          >
            {isLoading ? "Thinking…" : cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` : "Go deeper with AI"}
          </button>
          {askedHere && (
            <div aria-live="polite" className="mt-3 max-h-[40vh] overflow-y-auto border-t border-outline-variant pt-3">
              {isLoading && <p className="text-xs text-on-surface-variant">Generating answer…</p>}
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
