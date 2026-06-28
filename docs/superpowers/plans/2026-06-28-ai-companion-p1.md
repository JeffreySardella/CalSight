# AI Companion P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the "Go deeper" AI answer inline in the AI Companion popover, and wire `GET /api/stats/distribution` into the instant tier so a single-county stat shows a "ranks #N of 58 — safer than X%" percentile, with a live demo on StatsPage.

**Architecture:** Pure helpers (`measureToMetric`, `normalizeCounty`, distribution adapter) + a react-query `useDistribution` hook feed `explainContext`'s existing stat path. `AiCompanion` gains an inline answer region driven by its own `useAskAi` instance, plus distribution wiring gated to county + single/all-year contexts. StatsPage builds a county-scoped context when exactly one county is selected.

**Tech Stack:** React + TypeScript, @tanstack/react-query, Vitest + @testing-library/react, `react-markdown` + existing `InlineChart`.

Spec: `docs/superpowers/specs/2026-06-28-ai-companion-p1-design.md`

## Global Constraints

- No new npm dependencies (react-query, react-markdown, InlineChart all already present).
- Preserve the hybrid-tier invariant: no API call (`sendMessage`) until the explicit "Go deeper" click. The existing test `frontend/src/components/ai/AiCompanion.invariant.test.tsx` must still pass.
- Distribution percentile tier engages ONLY when: `current` is a `stat`, has a `county` geography, `measureToMetric(measure)` ≠ null, AND `current.filters.years.length <= 1` (empty = all years, or a single year). Multi-year selections fall back to the existing tier.
- County matching is by NAME via `normalizeCounty` (`s.trim().toLowerCase()`) on both the adapted distribution `id` and the subject `geography.id` — never by county code.
- Distribution is best-effort enrichment: if it errors/empty, fall back silently to the existing placeholder/chart tier (no error UI for the instant tier).
- Reuse `DistributionPoint` from `frontend/src/lib/ai/statNarrative.ts` (`{ id: string; name: string; value: number }`) — do not redefine it.
- Test files alongside source as `*.test.ts(x)`.
- Run frontend commands from `frontend/`.

---

## File Structure

New:
- `frontend/src/lib/ai/measureMetric.ts` — `DistributionMetric` type, `measureToMetric`, `normalizeCounty`, `adaptDistribution` (Task 1)
- `frontend/src/hooks/useDistribution.ts` — react-query hook (Task 2)
- Test files alongside each.

Modified:
- `frontend/src/components/ai/AiCompanion.tsx` — inline answer (Task 3) + distribution wiring (Task 4)
- `frontend/src/components/ai/AiCompanion.invariant.test.tsx` — extend the `useAskAi` mock (Task 3)
- `frontend/src/lib/ai/contextBuilders.ts` — `buildTotalCrashesContext` helper (Task 5)
- `frontend/src/pages/StatsPage.tsx` — use the helper for the totalIncidents Explainable (Task 5)

---

## Task 1: Metric mapping + distribution adapter (`measureMetric.ts`)

**Files:**
- Create: `frontend/src/lib/ai/measureMetric.ts`
- Test: `frontend/src/lib/ai/measureMetric.test.ts`

**Interfaces:**
- Consumes: `DistributionPoint` from `./statNarrative`.
- Produces:
  - `type DistributionMetric = "crash_count" | "total_killed" | "total_injured" | "fatal_crashes" | "alcohol_crashes" | "pedestrian_crashes"`
  - `measureToMetric(measure: string): DistributionMetric | null`
  - `normalizeCounty(name: string): string`
  - `type DistributionRow = { county_code: number; county_name: string; value: number }`
  - `adaptDistribution(rows: DistributionRow[]): DistributionPoint[]`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/ai/measureMetric.test.ts
import { describe, it, expect } from "vitest";
import { measureToMetric, normalizeCounty, adaptDistribution } from "./measureMetric";

describe("measureToMetric", () => {
  it("maps known distribution metrics", () => {
    expect(measureToMetric("crash_count")).toBe("crash_count");
    expect(measureToMetric("fatal_crashes")).toBe("fatal_crashes");
    expect(measureToMetric("pedestrian_crashes")).toBe("pedestrian_crashes");
  });
  it("returns null for unknown measures", () => {
    expect(measureToMetric("crashes_total")).toBeNull();
    expect(measureToMetric("")).toBeNull();
    expect(measureToMetric("ksi_rate")).toBeNull();
  });
});

describe("normalizeCounty", () => {
  it("trims and lowercases", () => {
    expect(normalizeCounty("  Kern ")).toBe("kern");
    expect(normalizeCounty("Los Angeles")).toBe("los angeles");
  });
});

describe("adaptDistribution", () => {
  it("maps endpoint rows to DistributionPoint with normalized id", () => {
    const out = adaptDistribution([
      { county_code: 15, county_name: "Kern", value: 100 },
      { county_code: 19, county_name: "Los Angeles", value: 500 },
    ]);
    expect(out).toEqual([
      { id: "kern", name: "Kern", value: 100 },
      { id: "los angeles", name: "Los Angeles", value: 500 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/measureMetric.test.ts`
Expected: FAIL — cannot resolve `./measureMetric`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/ai/measureMetric.ts
import type { DistributionPoint } from "./statNarrative";

export type DistributionMetric =
  | "crash_count" | "total_killed" | "total_injured"
  | "fatal_crashes" | "alcohol_crashes" | "pedestrian_crashes";

const METRICS: ReadonlySet<string> = new Set<DistributionMetric>([
  "crash_count", "total_killed", "total_injured",
  "fatal_crashes", "alcohol_crashes", "pedestrian_crashes",
]);

export function measureToMetric(measure: string): DistributionMetric | null {
  return METRICS.has(measure) ? (measure as DistributionMetric) : null;
}

export function normalizeCounty(name: string): string {
  return name.trim().toLowerCase();
}

export type DistributionRow = { county_code: number; county_name: string; value: number };

export function adaptDistribution(rows: DistributionRow[]): DistributionPoint[] {
  return rows.map((r) => ({ id: normalizeCounty(r.county_name), name: r.county_name, value: r.value }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/measureMetric.test.ts`
Expected: PASS (3 describe blocks, 4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai/measureMetric.ts frontend/src/lib/ai/measureMetric.test.ts
git commit -m "feat(ai): measure->metric map + distribution adapter"
```

---

## Task 2: Distribution fetch hook (`useDistribution.ts`)

**Files:**
- Create: `frontend/src/hooks/useDistribution.ts`
- Test: `frontend/src/hooks/useDistribution.test.tsx`

**Interfaces:**
- Consumes: `adaptDistribution`, `DistributionRow` from `../lib/ai/measureMetric`; `DistributionPoint` from `../lib/ai/statNarrative`; `API_BASE` from `../config`.
- Produces: `useDistribution(metric: string, year: number | null, options?: { enabled?: boolean }): { data: DistributionPoint[] | undefined; isLoading: boolean }`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/hooks/useDistribution.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDistribution } from "./useDistribution";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const rows = [{ county_code: 15, county_name: "Kern", value: 100 }];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => rows })) as unknown as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("useDistribution", () => {
  it("fetches with metric + year and returns adapted points", async () => {
    const { result } = renderHook(() => useDistribution("crash_count", 2023, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual([{ id: "kern", name: "Kern", value: 100 }]);
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("metric=crash_count");
    expect(url).toContain("year=2023");
  });

  it("omits year from the URL when year is null", async () => {
    const { result } = renderHook(() => useDistribution("crash_count", null, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).not.toContain("year=");
  });

  it("does not fetch when disabled", () => {
    renderHook(() => useDistribution("crash_count", null, { enabled: false }), { wrapper: wrapper() });
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useDistribution.test.tsx`
Expected: FAIL — cannot resolve `./useDistribution`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/hooks/useDistribution.ts
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../config";
import { adaptDistribution, type DistributionRow } from "../lib/ai/measureMetric";
import type { DistributionPoint } from "../lib/ai/statNarrative";

export function useDistribution(
  metric: string,
  year: number | null,
  options?: { enabled?: boolean },
): { data: DistributionPoint[] | undefined; isLoading: boolean } {
  const query = useQuery({
    queryKey: ["distribution", metric, year],
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<DistributionPoint[]> => {
      const params = new URLSearchParams({ metric });
      if (year != null) params.set("year", String(year));
      const res = await fetch(`${API_BASE}/api/stats/distribution?${params.toString()}`);
      if (!res.ok) throw new Error(`distribution ${res.status}`);
      const data = (await res.json()) as DistributionRow[];
      return adaptDistribution(data);
    },
  });
  return { data: query.data, isLoading: query.isLoading };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useDistribution.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDistribution.ts frontend/src/hooks/useDistribution.test.tsx
git commit -m "feat(ai): useDistribution react-query hook"
```

---

## Task 3: Inline deep-dive answer in the popover (`AiCompanion.tsx`)

**Files:**
- Modify: `frontend/src/components/ai/AiCompanion.tsx`
- Modify: `frontend/src/components/ai/AiCompanion.invariant.test.tsx` (extend mock)
- Test: `frontend/src/components/ai/AiCompanion.inline.test.tsx`

**Interfaces:**
- Consumes: `useAskAi()` returning `{ sendMessage, isLoading, error, retry, messages }`; `ChatMessage` type from `../../hooks/useAskAi`; `ReactMarkdown`; `InlineChart` from `../ask/InlineChart`.
- Produces: no new exports; new inline-answer behavior gated by an internal `askedHere` flag.

- [ ] **Step 1: Update the existing invariant test's mock so it still type-checks/runs**

In `AiCompanion.invariant.test.tsx`, replace the mock factory:

```tsx
const sendMessage = vi.fn();
vi.mock("../../hooks/useAskAi", () => ({
  useAskAi: () => ({ sendMessage, isLoading: false, error: null, retry: vi.fn(), messages: [] }),
}));
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/components/ai/AiCompanion.inline.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const hoisted = vi.hoisted(() => ({
  state: {
    sendMessage: vi.fn(),
    retry: vi.fn(),
    isLoading: false,
    error: null as string | null,
    messages: [] as Array<{ role: string; content: string; timestamp: number; chart?: unknown }>,
  },
}));
vi.mock("../../hooks/useAskAi", () => ({ useAskAi: () => hoisted.state }));

import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [2023], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function Trigger() {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>explain</button>;
}
function renderApp() {
  return render(<MemoryRouter><AiCompanionProvider><Trigger /></AiCompanionProvider></MemoryRouter>);
}

beforeEach(() => {
  hoisted.state.sendMessage = vi.fn();
  hoisted.state.retry = vi.fn();
  hoisted.state.isLoading = false;
  hoisted.state.error = null;
  hoisted.state.messages = [];
});

describe("AiCompanion inline deep-dive", () => {
  it("does not show any prior assistant answer before Go deeper is clicked", () => {
    hoisted.state.messages = [{ role: "assistant", content: "STALE ANSWER", timestamp: 1 }];
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    expect(screen.queryByText("STALE ANSWER")).toBeNull();
  });

  it("renders the latest assistant answer after Go deeper", () => {
    hoisted.state.messages = [
      { role: "user", content: "q", timestamp: 1 },
      { role: "assistant", content: "Fresh inline answer.", timestamp: 2 },
    ];
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    fireEvent.click(screen.getByText("Go deeper with AI"));
    expect(screen.getByText("Fresh inline answer.")).toBeTruthy();
  });

  it("shows a thinking state while loading after Go deeper", () => {
    hoisted.state.isLoading = true;
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    fireEvent.click(screen.getByText(/Thinking|Go deeper/));
    expect(screen.getByText(/Thinking/)).toBeTruthy();
  });

  it("shows an error with a retry button after Go deeper", () => {
    hoisted.state.error = "Rate limited.";
    renderApp();
    fireEvent.click(screen.getByText("explain"));
    fireEvent.click(screen.getByText("Go deeper with AI"));
    expect(screen.getByText("Rate limited.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(hoisted.state.retry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/ai/AiCompanion.inline.test.tsx`
Expected: FAIL — stale answer assertion or "Fresh inline answer." not found (no inline region yet).

- [ ] **Step 4: Implement the inline answer region**

In `AiCompanion.tsx`:

Add imports at the top:
```tsx
import ReactMarkdown from "react-markdown";
import InlineChart from "../ask/InlineChart";
import type { ChatMessage } from "../../hooks/useAskAi";
```

Extend the hook destructure and add state inside `AiCompanionProvider`:
```tsx
  const { sendMessage, isLoading, error, retry, messages } = useAskAi();
  const [askedHere, setAskedHere] = useState(false);
```

Reset the flag whenever the opened context changes (add near the existing Escape effect):
```tsx
  useEffect(() => { setAskedHere(false); }, [current]);
```

Compute the latest assistant message (place just before the `return`):
```tsx
  const lastAnswer: ChatMessage | undefined =
    [...messages].reverse().find((m) => m.role === "assistant");
```

Change the "Go deeper" button's onClick to set the flag, and add the answer region directly after the button (inside the dialog `<div>`):
```tsx
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/ai/AiCompanion.inline.test.tsx src/components/ai/AiCompanion.invariant.test.tsx`
Expected: PASS (inline 4 tests + invariant 2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ai/AiCompanion.tsx frontend/src/components/ai/AiCompanion.inline.test.tsx frontend/src/components/ai/AiCompanion.invariant.test.tsx
git commit -m "feat(ai): render deep-dive answer inline in companion popover"
```

---

## Task 4: Wire distribution into the instant tier (`AiCompanion.tsx`)

**Files:**
- Modify: `frontend/src/components/ai/AiCompanion.tsx`
- Test: `frontend/src/components/ai/AiCompanion.distribution.test.tsx`

**Interfaces:**
- Consumes: `useDistribution` from `../../hooks/useDistribution`; `measureToMetric` from `../../lib/ai/measureMetric`.
- Produces: distribution passed into `explainContext(current, { distribution })` under the gate.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ai/AiCompanion.distribution.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../hooks/useAskAi", () => ({
  useAskAi: () => ({ sendMessage: vi.fn(), isLoading: false, error: null, retry: vi.fn(), messages: [] }),
}));
// Always return a 2-county distribution; the provider's gate decides whether to use it.
vi.mock("../../hooks/useDistribution", () => ({
  useDistribution: () => ({
    data: [{ id: "kern", name: "Kern", value: 100 }, { id: "x", name: "X", value: 500 }],
    isLoading: false,
  }),
}));

import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const baseFilters = {
  years: [2023], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

const countyStat: DataContext = {
  kind: "stat", label: "Total crashes · Kern", measure: "crash_count", value: 100,
  geography: { type: "county", id: "kern", name: "Kern" }, filters: baseFilters,
};
const statewideStat: DataContext = {
  kind: "stat", label: "Total crashes statewide", measure: "crash_count", value: 100, filters: baseFilters,
};

function Trigger({ ctx }: { ctx: DataContext }) {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>open</button>;
}
function renderWith(ctx: DataContext) {
  return render(<MemoryRouter><AiCompanionProvider><Trigger ctx={ctx} /></AiCompanionProvider></MemoryRouter>);
}

describe("AiCompanion distribution tier", () => {
  it("renders a percentile narrative for a single-county stat", () => {
    renderWith(countyStat);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog").textContent).toMatch(/ranks #|safer than/i);
  });

  it("does not use distribution for a statewide stat (no county geography)", () => {
    renderWith(statewideStat);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog").textContent).not.toMatch(/ranks #|safer than/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ai/AiCompanion.distribution.test.tsx`
Expected: FAIL — the single-county case shows the placeholder, not a percentile (distribution not wired yet).

- [ ] **Step 3: Implement the distribution wiring**

In `AiCompanion.tsx`, add imports:
```tsx
import { useDistribution } from "../../hooks/useDistribution";
import { measureToMetric } from "../../lib/ai/measureMetric";
```

Inside `AiCompanionProvider`, before computing `explanation`, derive the gate and fetch:
```tsx
  const metric = current?.kind === "stat" ? measureToMetric(current.measure) : null;
  const years = current?.filters.years ?? [];
  const distEnabled =
    current?.kind === "stat" &&
    current.geography?.type === "county" &&
    metric != null &&
    years.length <= 1;
  const distYear = years.length === 1 ? years[0] : null;
  const { data: distribution } = useDistribution(metric ?? "crash_count", distYear, { enabled: distEnabled });
```

Change the `explanation` computation to pass distribution only when enabled:
```tsx
  const explanation = current
    ? explainContext(current, distEnabled ? { distribution } : undefined)
    : null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ai/AiCompanion.distribution.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full AI component + lib suite to confirm no regression**

Run: `npx vitest run src/components/ai src/lib/ai src/hooks/useDistribution.test.tsx`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ai/AiCompanion.tsx frontend/src/components/ai/AiCompanion.distribution.test.tsx
git commit -m "feat(ai): wire /stats/distribution percentile into instant tier (county, single/all-year)"
```

---

## Task 5: County-scoped totalIncidents context (`contextBuilders.ts` + `StatsPage.tsx`)

**Files:**
- Modify: `frontend/src/lib/ai/contextBuilders.ts`
- Test: `frontend/src/lib/ai/contextBuilders.test.ts`
- Modify: `frontend/src/pages/StatsPage.tsx`

**Interfaces:**
- Consumes: `statContext`, `FilterSnapshot` (from `./dataContext`), `normalizeCounty` (from `./measureMetric`).
- Produces: `buildTotalCrashesContext(args: { totalIncidents: number | null; counties: Set<string>; filters: FilterSnapshot }): DataContext | null`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/ai/contextBuilders.test.ts
import { describe, it, expect } from "vitest";
import { buildTotalCrashesContext } from "./contextBuilders";
import type { FilterSnapshot } from "./dataContext";

const filters: FilterSnapshot = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("buildTotalCrashesContext", () => {
  it("returns null when totalIncidents is null", () => {
    expect(buildTotalCrashesContext({ totalIncidents: null, counties: new Set(), filters })).toBeNull();
  });

  it("builds a county-scoped stat when exactly one county is selected", () => {
    const ctx = buildTotalCrashesContext({ totalIncidents: 1234, counties: new Set(["Kern"]), filters });
    expect(ctx).not.toBeNull();
    expect(ctx!.kind).toBe("stat");
    expect(ctx!.measure).toBe("crash_count");
    expect(ctx!.geography).toEqual({ type: "county", id: "kern", name: "Kern" });
    expect(ctx!.label).toBe("Total crashes · Kern");
  });

  it("builds a statewide stat with no geography for 0 or multiple counties", () => {
    const zero = buildTotalCrashesContext({ totalIncidents: 5, counties: new Set(), filters });
    const many = buildTotalCrashesContext({ totalIncidents: 5, counties: new Set(["Kern", "Inyo"]), filters });
    expect(zero!.geography).toBeUndefined();
    expect(zero!.label).toBe("Total crashes statewide");
    expect(zero!.measure).toBe("crash_count");
    expect(many!.geography).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/ai/contextBuilders.test.ts`
Expected: FAIL — `buildTotalCrashesContext` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `frontend/src/lib/ai/contextBuilders.ts` (and add the import at the top):

```tsx
import { normalizeCounty } from "./measureMetric";
```

```tsx
export function buildTotalCrashesContext(args: {
  totalIncidents: number | null;
  counties: Set<string>;
  filters: FilterSnapshot;
}): DataContext | null {
  if (args.totalIncidents == null) return null;
  const names = [...args.counties];
  if (names.length === 1) {
    const name = names[0];
    return statContext({
      label: `Total crashes · ${name}`,
      measure: "crash_count",
      geography: { type: "county", id: normalizeCounty(name), name },
      value: args.totalIncidents,
      filters: args.filters,
    });
  }
  return statContext({
    label: "Total crashes statewide",
    measure: "crash_count",
    value: args.totalIncidents,
    filters: args.filters,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/ai/contextBuilders.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the helper into StatsPage**

In `frontend/src/pages/StatsPage.tsx`:

Update the import line that brings in `statContext, snapshotFilters`:
```tsx
import { statContext, snapshotFilters, buildTotalCrashesContext } from "../lib/ai/contextBuilders";
```
(Keep `statContext` if it is still used elsewhere in the file; if not, drop it from the import.)

Replace the existing totalIncidents `<Explainable>` block (currently uses `statContext({ label: "Total crashes statewide", measure: "crashes_total", ... })`) with the helper-driven version:

```tsx
              <p className="text-3xl sm:text-4xl font-headline font-bold text-on-surface tracking-tight hero-value" aria-label={`Total incidents: ${totalIncidents != null ? totalIncidents.toLocaleString() : "unavailable"}`}>
                {(() => {
                  const totalCtx = buildTotalCrashesContext({ totalIncidents: totalIncidents ?? null, counties, filters: snapshotFilters(filters) });
                  return totalCtx ? (
                    <Explainable context={totalCtx}>{totalIncidents!.toLocaleString()}</Explainable>
                  ) : "—";
                })()}
              </p>
```

(`counties` is the existing `Set<string>` of selected county names already in scope in this component; `filters` is the existing `FilterInputs` passed to `snapshotFilters` elsewhere in the file.)

- [ ] **Step 6: Verify the full suite + typecheck**

Run: `npx vitest run src/components/ai src/lib/ai src/hooks/useDistribution.test.tsx src/pages` (all pass)
Run: `npx tsc --noEmit` (clean, exit 0)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/ai/contextBuilders.ts frontend/src/lib/ai/contextBuilders.test.ts frontend/src/pages/StatsPage.tsx
git commit -m "feat(ai): county-scoped totalIncidents context for percentile demo"
```

---

## Self-Review

**Spec coverage:**
- Inline deep-dive (askedHere gate, loading/error/answer, markdown+chart, aria-live, no stale history) → Task 3. ✅
- `useDistribution` hook (enabled, URL with/without year, adapted) → Task 2. ✅
- `measureToMetric` + name-normalized adapter → Task 1. ✅
- Provider gate (county + mappable measure + ≤1 year) + pass to explainContext → Task 4. ✅
- StatsPage one-county demo + statewide fallback + `crashes_total`→`crash_count` → Task 5. ✅
- Hybrid invariant preserved (mock extended, invariant test still run) → Task 3 Steps 1 & 5. ✅
- Best-effort fallback (no distribution → existing tier) → Task 4 (explainContext already falls back when `distribution` is empty/undefined). ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `DistributionPoint` reused from `statNarrative` across Tasks 1/2/4. `measureToMetric(measure: string): DistributionMetric | null`, `normalizeCounty`, `adaptDistribution(rows: DistributionRow[])` used identically in Tasks 1/2/5. `useDistribution(metric, year, { enabled })` signature matches Task 4's call. `buildTotalCrashesContext({ totalIncidents, counties, filters })` matches Task 5's StatsPage call. `explainContext(ctx, { distribution })` matches its existing signature. ✅

**Note for implementer:** `current.measure` is a `string` on the `stat` variant of `DataContext`; `measureToMetric` takes a `string`, so no extra guard is needed. If `tsc` flags `current.measure` as possibly-undefined after the `kind === "stat"` narrowing, pass `current.measure ?? ""`.
