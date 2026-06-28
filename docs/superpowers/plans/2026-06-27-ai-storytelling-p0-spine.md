# AI Storytelling — P0 (Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared primitives every later phase depends on — `DataContext`, the local "instant tier" explanation engine, the `AiCompanion` surface, and the `<Explainable>` wrapper — plus the `/api/stats/distribution` endpoint that powers percentile context.

**Architecture:** A serializable `DataContext` describes any data element (frozen literal value/series + filter snapshot). `<Explainable>` wraps elements, adds affordance + a11y, and hands its context to `AiCompanionProvider`, which renders a popover/bottom-sheet. The companion resolves explanations in two tiers: instant local (`explainContext` → `statNarrative` / existing `narrativeEngine`) and on-demand Groq (existing `useAskAi`). The backend adds one read endpoint returning per-county values for percentile math.

**Tech Stack:** React 18 + TypeScript + Vite + Vitest (frontend); FastAPI + SQLAlchemy + pytest (backend). Charts via the existing `ChartData` shape. No new runtime dependencies.

## Global Constraints

- No new npm or pip dependencies in P0 — reuse existing libs only.
- All new frontend files live under `frontend/src/lib/ai/` and `frontend/src/components/ai/`.
- `DataContext` and `FilterSnapshot` MUST be JSON-serializable (no `Set`, no `Date`, no functions) so they round-trip through URLs and storage.
- The instant tier MUST NOT make network/LLM calls. Only the explicit "Go deeper with AI" action calls `/api/ask`.
- Follow existing test patterns: frontend `*.test.ts(x)` beside source, run with `npx vitest run <path>`; backend tests in `backend/tests/`, run with `python -m pytest`.
- Backend endpoint mirrors the `/stats/highways` style: `_limiter` rate limit, `Cache-Control` header, `Depends(get_db)`, `parse_*` filter helpers.

---

## File Structure

- `frontend/src/lib/ai/dataContext.ts` — `DataContext`, `FilterSnapshot` types; `hashContext`, `serializeContext`, `deserializeContext`.
- `frontend/src/lib/ai/contextBuilders.ts` — `snapshotFilters()`, `statContext()`, `chartContext()`.
- `frontend/src/lib/ai/statNarrative.ts` — `statNarrative()` percentile/rank prose from a distribution.
- `frontend/src/lib/ai/explainContext.ts` — `explainContext()` dispatcher (stat → statNarrative, chart → narrativeEngine).
- `frontend/src/components/ai/AiCompanion.tsx` — `AiCompanionProvider`, `useAiCompanion()`, the popover/sheet surface.
- `frontend/src/components/ai/Explainable.tsx` — `<Explainable>` wrapper + `useExplainable()`.
- `backend/app/routers/stats.py` — add `GET /stats/distribution` (modify).
- Tests beside each source file; backend `backend/tests/api/test_stats_distribution.py`.

---

## Task 1: `DataContext` types + serialization

**Files:**
- Create: `frontend/src/lib/ai/dataContext.ts`
- Test: `frontend/src/lib/ai/dataContext.test.ts`

**Interfaces:**
- Produces:
  - `type FilterSnapshot = { years: number[]; severities: string[]; counties: string[]; causes: string[]; alcohol: boolean | null; distracted: boolean | null; pedestrian: boolean | null; cyclist: boolean | null; drug: boolean | null; driverAge: string | null; weather: string[]; lighting: string[]; collisionType: string[]; roadType: string | null; hitRun: boolean | null }`
  - `type DataContext = { kind: "stat" | "chart" | "county" | "highway" | "view" | "correlation"; label: string; filters: FilterSnapshot; measure?: string; geography?: { type: "county" | "highway" | "state"; id: string; name: string }; value?: number; series?: { label: string; value: number }[]; }`
  - `hashContext(ctx: DataContext): string`
  - `serializeContext(ctx: DataContext): string`
  - `deserializeContext(raw: string): DataContext | null`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/ai/dataContext.test.ts
import { describe, it, expect } from "vitest";
import { hashContext, serializeContext, deserializeContext, type DataContext } from "./dataContext";

const emptyFilters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

const ctx: DataContext = {
  kind: "stat", label: "Fatality rate · Kern County",
  measure: "fatality_rate", value: 1.23,
  geography: { type: "county", id: "15", name: "Kern" },
  filters: emptyFilters,
};

describe("dataContext", () => {
  it("round-trips through serialize/deserialize", () => {
    const restored = deserializeContext(serializeContext(ctx));
    expect(restored).toEqual(ctx);
  });

  it("returns null for malformed input", () => {
    expect(deserializeContext("not json")).toBeNull();
  });

  it("hashes equal contexts equally and differs on value", () => {
    expect(hashContext(ctx)).toBe(hashContext({ ...ctx }));
    expect(hashContext(ctx)).not.toBe(hashContext({ ...ctx, value: 9.99 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/ai/dataContext.test.ts`
Expected: FAIL — cannot find module `./dataContext`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/ai/dataContext.ts
export type FilterSnapshot = {
  years: number[];
  severities: string[];
  counties: string[];
  causes: string[];
  alcohol: boolean | null;
  distracted: boolean | null;
  pedestrian: boolean | null;
  cyclist: boolean | null;
  drug: boolean | null;
  driverAge: string | null;
  weather: string[];
  lighting: string[];
  collisionType: string[];
  roadType: string | null;
  hitRun: boolean | null;
};

export type ChartPoint = { label: string; value: number };

export type DataContext = {
  kind: "stat" | "chart" | "county" | "highway" | "view" | "correlation";
  label: string;
  filters: FilterSnapshot;
  measure?: string;
  geography?: { type: "county" | "highway" | "state"; id: string; name: string };
  value?: number;
  series?: ChartPoint[];
};

export function serializeContext(ctx: DataContext): string {
  return JSON.stringify(ctx);
}

export function deserializeContext(raw: string): DataContext | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.kind === "string" && parsed.filters) {
      return parsed as DataContext;
    }
    return null;
  } catch {
    return null;
  }
}

// Stable, order-independent hash for cache keys.
export function hashContext(ctx: DataContext): string {
  const stable = JSON.stringify(ctx, Object.keys(ctx).sort());
  let h = 0;
  for (let i = 0; i < stable.length; i++) {
    h = (h << 5) - h + stable.charCodeAt(i);
    h |= 0;
  }
  return `ctx_${h >>> 0}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/ai/dataContext.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai/dataContext.ts frontend/src/lib/ai/dataContext.test.ts
git commit -m "feat(ai): DataContext types + serialization (P0 spine)"
```

---

## Task 2: Context builders from filter/UI state

**Files:**
- Create: `frontend/src/lib/ai/contextBuilders.ts`
- Test: `frontend/src/lib/ai/contextBuilders.test.ts`

**Interfaces:**
- Consumes: `FilterSnapshot`, `DataContext`, `ChartPoint` from `./dataContext`.
- Produces:
  - `snapshotFilters(f: FilterInputs): FilterSnapshot` where `FilterInputs` accepts `Set<string>`/`Set<number>` fields exactly as returned by `useFilterParams` (see type below).
  - `statContext(args: { label: string; measure: string; value: number; geography?: DataContext["geography"]; filters: FilterSnapshot }): DataContext`
  - `chartContext(args: { label: string; series: ChartPoint[]; measure?: string; filters: FilterSnapshot }): DataContext`
  - `type FilterInputs = { selectedYears: Set<number>; selectedSeverities: Set<string>; selectedCounties: Set<string>; selectedCauses: Set<string>; selectedAlcohol: boolean; selectedDistracted: boolean; selectedPedestrian: boolean; selectedCyclist: boolean; selectedDrug: boolean; selectedDriverAge: string | null; selectedWeather: Set<string>; selectedLighting: Set<string>; selectedCollisionType: Set<string>; selectedRoadType: string | null; selectedHitRun: boolean }`

> Note: `useFilterParams` returns boolean flags (not `boolean | null`). `snapshotFilters` maps `false` → `null` for flags so "no filter" is distinguishable in the snapshot. Sets become sorted arrays for stability.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/ai/contextBuilders.test.ts
import { describe, it, expect } from "vitest";
import { snapshotFilters, statContext, chartContext } from "./contextBuilders";

const inputs = {
  selectedYears: new Set([2023, 2022]),
  selectedSeverities: new Set(["Fatal"]),
  selectedCounties: new Set(["kern"]),
  selectedCauses: new Set<string>(),
  selectedAlcohol: true,
  selectedDistracted: false,
  selectedPedestrian: false,
  selectedCyclist: false,
  selectedDrug: false,
  selectedDriverAge: null,
  selectedWeather: new Set<string>(),
  selectedLighting: new Set<string>(),
  selectedCollisionType: new Set<string>(),
  selectedRoadType: null,
  selectedHitRun: false,
};

describe("contextBuilders", () => {
  it("snapshots filters: sorts sets, maps false flags to null", () => {
    const snap = snapshotFilters(inputs);
    expect(snap.years).toEqual([2022, 2023]);
    expect(snap.severities).toEqual(["Fatal"]);
    expect(snap.alcohol).toBe(true);
    expect(snap.distracted).toBeNull();
    expect(snap.weather).toEqual([]);
  });

  it("builds a stat context", () => {
    const ctx = statContext({
      label: "Fatality rate · Kern", measure: "fatality_rate", value: 1.5,
      geography: { type: "county", id: "15", name: "Kern" },
      filters: snapshotFilters(inputs),
    });
    expect(ctx.kind).toBe("stat");
    expect(ctx.value).toBe(1.5);
    expect(ctx.measure).toBe("fatality_rate");
  });

  it("builds a chart context with frozen series", () => {
    const ctx = chartContext({
      label: "Crashes by hour", series: [{ label: "0", value: 10 }],
      filters: snapshotFilters(inputs),
    });
    expect(ctx.kind).toBe("chart");
    expect(ctx.series).toEqual([{ label: "0", value: 10 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/ai/contextBuilders.test.ts`
Expected: FAIL — cannot find module `./contextBuilders`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/ai/contextBuilders.ts
import type { DataContext, FilterSnapshot, ChartPoint } from "./dataContext";

export type FilterInputs = {
  selectedYears: Set<number>;
  selectedSeverities: Set<string>;
  selectedCounties: Set<string>;
  selectedCauses: Set<string>;
  selectedAlcohol: boolean;
  selectedDistracted: boolean;
  selectedPedestrian: boolean;
  selectedCyclist: boolean;
  selectedDrug: boolean;
  selectedDriverAge: string | null;
  selectedWeather: Set<string>;
  selectedLighting: Set<string>;
  selectedCollisionType: Set<string>;
  selectedRoadType: string | null;
  selectedHitRun: boolean;
};

const flag = (b: boolean): boolean | null => (b ? true : null);
const sortedNums = (s: Set<number>) => [...s].sort((a, b) => a - b);
const sortedStrs = (s: Set<string>) => [...s].sort();

export function snapshotFilters(f: FilterInputs): FilterSnapshot {
  return {
    years: sortedNums(f.selectedYears),
    severities: sortedStrs(f.selectedSeverities),
    counties: sortedStrs(f.selectedCounties),
    causes: sortedStrs(f.selectedCauses),
    alcohol: flag(f.selectedAlcohol),
    distracted: flag(f.selectedDistracted),
    pedestrian: flag(f.selectedPedestrian),
    cyclist: flag(f.selectedCyclist),
    drug: flag(f.selectedDrug),
    driverAge: f.selectedDriverAge,
    weather: sortedStrs(f.selectedWeather),
    lighting: sortedStrs(f.selectedLighting),
    collisionType: sortedStrs(f.selectedCollisionType),
    roadType: f.selectedRoadType,
    hitRun: flag(f.selectedHitRun),
  };
}

export function statContext(args: {
  label: string; measure: string; value: number;
  geography?: DataContext["geography"]; filters: FilterSnapshot;
}): DataContext {
  return { kind: "stat", label: args.label, measure: args.measure, value: args.value, geography: args.geography, filters: args.filters };
}

export function chartContext(args: {
  label: string; series: ChartPoint[]; measure?: string; filters: FilterSnapshot;
}): DataContext {
  return { kind: "chart", label: args.label, series: args.series, measure: args.measure, filters: args.filters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/ai/contextBuilders.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai/contextBuilders.ts frontend/src/lib/ai/contextBuilders.test.ts
git commit -m "feat(ai): context builders from filter state (P0 spine)"
```

---

## Task 3: `statNarrative` — percentile/rank prose (instant tier for stats)

**Files:**
- Create: `frontend/src/lib/ai/statNarrative.ts`
- Test: `frontend/src/lib/ai/statNarrative.test.ts`

**Interfaces:**
- Produces:
  - `type DistributionPoint = { id: string; name: string; value: number }`
  - `type StatNarrative = { percentile: number; rank: number; total: number; paragraph: string }`
  - `statNarrative(args: { label: string; value: number; subjectId: string; distribution: DistributionPoint[]; higherIsWorse?: boolean }): StatNarrative`

> `percentile` = share of the distribution the subject is "safer than" (lower value = safer when `higherIsWorse`, the default). `rank` is 1-based with rank 1 = worst.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/ai/statNarrative.test.ts
import { describe, it, expect } from "vitest";
import { statNarrative, type DistributionPoint } from "./statNarrative";

const dist: DistributionPoint[] = [
  { id: "a", name: "A", value: 1 },
  { id: "b", name: "B", value: 2 },
  { id: "c", name: "C", value: 3 },
  { id: "d", name: "D", value: 4 },
];

describe("statNarrative", () => {
  it("ranks the worst (highest) subject rank 1", () => {
    const n = statNarrative({ label: "Fatality rate", value: 4, subjectId: "d", distribution: dist });
    expect(n.rank).toBe(1);
    expect(n.total).toBe(4);
  });

  it("computes percentile safer-than for a low value", () => {
    const n = statNarrative({ label: "Fatality rate", value: 1, subjectId: "a", distribution: dist });
    // safer than B, C, D = 3 of 4 = 75%
    expect(n.percentile).toBe(75);
    expect(n.paragraph).toContain("safer than 75%");
  });

  it("produces a non-empty paragraph naming the metric", () => {
    const n = statNarrative({ label: "Fatality rate", value: 2, subjectId: "b", distribution: dist });
    expect(n.paragraph.toLowerCase()).toContain("fatality rate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/ai/statNarrative.test.ts`
Expected: FAIL — cannot find module `./statNarrative`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/ai/statNarrative.ts
export type DistributionPoint = { id: string; name: string; value: number };

export type StatNarrative = {
  percentile: number;
  rank: number;
  total: number;
  paragraph: string;
};

export function statNarrative(args: {
  label: string;
  value: number;
  subjectId: string;
  distribution: DistributionPoint[];
  higherIsWorse?: boolean;
}): StatNarrative {
  const higherIsWorse = args.higherIsWorse ?? true;
  const total = args.distribution.length;
  // rank 1 = worst
  const sorted = [...args.distribution].sort((a, b) =>
    higherIsWorse ? b.value - a.value : a.value - b.value,
  );
  const idx = sorted.findIndex((d) => d.id === args.subjectId);
  const rank = idx >= 0 ? idx + 1 : total;

  const saferCount = args.distribution.filter((d) =>
    higherIsWorse ? d.value < args.value : d.value > args.value,
  ).length;
  const percentile = total > 1 ? Math.round((saferCount / (total - 0)) * 100) : 0;

  const paragraph =
    `${args.label} here ranks #${rank} of ${total} — ` +
    `safer than ${percentile}% of the group. ` +
    `This is an association in the data, not a cause.`;

  return { percentile, rank, total, paragraph };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/ai/statNarrative.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai/statNarrative.ts frontend/src/lib/ai/statNarrative.test.ts
git commit -m "feat(ai): statNarrative percentile/rank prose (P0 spine)"
```

---

## Task 4: `explainContext` dispatcher (instant tier)

**Files:**
- Create: `frontend/src/lib/ai/explainContext.ts`
- Test: `frontend/src/lib/ai/explainContext.test.ts`

**Interfaces:**
- Consumes: `DataContext` from `./dataContext`; `statNarrative`, `DistributionPoint` from `./statNarrative`.
- Produces:
  - `type Explanation = { headline: string; body: string }`
  - `explainContext(ctx: DataContext, deps?: { distribution?: DistributionPoint[] }): Explanation`

> P0 handles `kind: "stat"` (via `statNarrative`) and `kind: "chart"` (simple peak/total summary inline — full `narrativeEngine` integration lands in P1 when charts are wrapped). Any other kind returns a generic label-based explanation. Keeping the chart branch self-contained avoids depending on `narrativeEngine`'s richer types in P0.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/ai/explainContext.test.ts
import { describe, it, expect } from "vitest";
import { explainContext } from "./explainContext";
import type { DataContext } from "./dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("explainContext", () => {
  it("explains a stat using the distribution", () => {
    const ctx: DataContext = { kind: "stat", label: "Fatality rate", measure: "fatality_rate", value: 1, geography: { type: "county", id: "a", name: "A" }, filters };
    const out = explainContext(ctx, { distribution: [
      { id: "a", name: "A", value: 1 }, { id: "b", name: "B", value: 5 },
    ]});
    expect(out.body).toContain("safer than");
  });

  it("explains a chart by naming its peak", () => {
    const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "8am", value: 3 }, { label: "5pm", value: 9 }], filters };
    const out = explainContext(ctx);
    expect(out.body).toContain("5pm");
  });

  it("falls back to label for unknown kinds", () => {
    const ctx: DataContext = { kind: "county", label: "Kern County", filters };
    const out = explainContext(ctx);
    expect(out.headline).toContain("Kern County");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/ai/explainContext.test.ts`
Expected: FAIL — cannot find module `./explainContext`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/ai/explainContext.ts
import type { DataContext } from "./dataContext";
import { statNarrative, type DistributionPoint } from "./statNarrative";

export type Explanation = { headline: string; body: string };

export function explainContext(
  ctx: DataContext,
  deps?: { distribution?: DistributionPoint[] },
): Explanation {
  if (ctx.kind === "stat" && ctx.value != null && deps?.distribution?.length) {
    const subjectId = ctx.geography?.id ?? "__subject__";
    const n = statNarrative({
      label: ctx.label, value: ctx.value, subjectId,
      distribution: deps.distribution,
    });
    return { headline: ctx.label, body: n.paragraph };
  }

  if (ctx.kind === "chart" && ctx.series?.length) {
    const peak = ctx.series.reduce((a, b) => (b.value > a.value ? b : a));
    const total = ctx.series.reduce((sum, p) => sum + p.value, 0);
    return {
      headline: ctx.label,
      body: `Peaks at ${peak.label} (${peak.value.toLocaleString()}), out of ${total.toLocaleString()} total.`,
    };
  }

  return { headline: ctx.label, body: `Select "Go deeper with AI" to analyze ${ctx.label}.` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/ai/explainContext.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/ai/explainContext.ts frontend/src/lib/ai/explainContext.test.ts
git commit -m "feat(ai): explainContext instant-tier dispatcher (P0 spine)"
```

---

## Task 5: `/api/stats/distribution` backend endpoint

**Files:**
- Modify: `backend/app/routers/stats.py` (add endpoint near `stats_highways`)
- Test: `backend/tests/api/test_stats_distribution.py`

**Interfaces:**
- Produces: `GET /api/stats/distribution?metric=<m>&year=<y>` → `200` with `list[{county_code: int, county_name: str, value: float}]` (all counties present in the data for the filters), or `422` for an invalid `metric`.
- `metric` accepts the same values as the existing `rank_counties` tool: `crash_count | total_killed | total_injured | fatal_crashes | alcohol_crashes | pedestrian_crashes`.

> Reuse the `rank_counties` query shape (`backend/app/ai_tools.py:220`) but without the small `limit` — return every county. This is the distribution the frontend reduces into a percentile.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/api/test_stats_distribution.py
def test_distribution_returns_all_counties(client):
    r = client.get("/api/stats/distribution?metric=crash_count")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert all("county_code" in row and "value" in row for row in body)


def test_distribution_rejects_bad_metric(client):
    r = client.get("/api/stats/distribution?metric=bogus")
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/api/test_stats_distribution.py -q`
Expected: FAIL — 404 (route not defined) so the 200 assertion fails.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/app/routers/stats.py` (after `stats_highways`). Reuse the existing imports (`select`, `func`, `Crash`, `Query`, `Request`, `Response`, `Depends`, `get_db`, `_limiter`):

```python
_DISTRIBUTION_METRICS = {
    "crash_count", "total_killed", "total_injured",
    "fatal_crashes", "alcohol_crashes", "pedestrian_crashes",
}


@router.get("/stats/distribution")
@_limiter.limit("1000/minute;20000/hour")
def stats_distribution(
    request: Request,
    response: Response,
    metric: str = Query("crash_count"),
    year: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Per-county values for one metric — the distribution the frontend reduces
    into percentile/rank context ("safer than X% of counties").

    Mirrors the rank_counties tool but returns every county (no small limit).
    """
    if metric not in _DISTRIBUTION_METRICS:
        raise HTTPException(status_code=422, detail=f"invalid metric: {metric}")

    response.headers["Cache-Control"] = "public, max-age=3600, stale-while-revalidate=86400"

    preds = []
    if year is not None:
        preds.append(Crash.crash_year == year)
    if metric == "fatal_crashes":
        preds.append(Crash.severity == "Fatal")
        agg = func.count(Crash.id)
    elif metric == "alcohol_crashes":
        preds.append(Crash.is_alcohol_involved.is_(True))
        agg = func.count(Crash.id)
    elif metric == "pedestrian_crashes":
        preds.append(Crash.pedestrian_involved.is_(True))
        agg = func.count(Crash.id)
    elif metric == "total_killed":
        agg = func.sum(Crash.number_killed)
    elif metric == "total_injured":
        agg = func.sum(Crash.number_injured)
    else:
        agg = func.count(Crash.id)

    stmt = (
        select(
            Crash.county_code.label("county_code"),
            Crash.county_name.label("county_name"),
            agg.label("value"),
        )
        .where(*preds)
        .group_by(Crash.county_code, Crash.county_name)
    )
    rows = db.execute(stmt).fetchall()
    return [
        {"county_code": r.county_code, "county_name": r.county_name, "value": float(r.value or 0)}
        for r in rows
    ]
```

If `HTTPException` is not already imported at the top of `stats.py`, add it to the existing `from fastapi import ...` line.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/api/test_stats_distribution.py -q`
Expected: PASS (2 tests). (Requires the seeded test DB the other `tests/api/` tests use.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/stats.py backend/tests/api/test_stats_distribution.py
git commit -m "feat(api): GET /stats/distribution per-county metric values (P0 spine)"
```

---

## Task 6: `AiCompanionProvider` + companion surface

**Files:**
- Create: `frontend/src/components/ai/AiCompanion.tsx`
- Test: `frontend/src/components/ai/AiCompanion.test.tsx`

**Interfaces:**
- Consumes: `DataContext` from `../../lib/ai/dataContext`; `explainContext` from `../../lib/ai/explainContext`.
- Produces:
  - `AiCompanionProvider({ children }: { children: ReactNode }): JSX.Element`
  - `useAiCompanion(): { open: (ctx: DataContext) => void; close: () => void; current: DataContext | null }`
  - Renders a region with `role="dialog"` and `aria-label="AI explanation"` when open, showing the instant-tier `explainContext` output. ESC closes.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ai/AiCompanion.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiCompanionProvider, useAiCompanion } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function Trigger() {
  const { open } = useAiCompanion();
  return <button onClick={() => open(ctx)}>explain</button>;
}

describe("AiCompanion", () => {
  it("opens on demand and shows the instant explanation", () => {
    render(<AiCompanionProvider><Trigger /></AiCompanionProvider>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("explain"));
    const dialog = screen.getByRole("dialog", { name: "AI explanation" });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Crashes by hour");
  });

  it("closes on Escape", () => {
    render(<AiCompanionProvider><Trigger /></AiCompanionProvider>);
    fireEvent.click(screen.getByText("explain"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ai/AiCompanion.test.tsx`
Expected: FAIL — cannot find module `./AiCompanion`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/ai/AiCompanion.tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ai/AiCompanion.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ai/AiCompanion.tsx frontend/src/components/ai/AiCompanion.test.tsx
git commit -m "feat(ai): AiCompanion provider + instant-tier surface (P0 spine)"
```

---

## Task 7: `<Explainable>` wrapper + affordance + a11y

**Files:**
- Create: `frontend/src/components/ai/Explainable.tsx`
- Test: `frontend/src/components/ai/Explainable.test.tsx`

**Interfaces:**
- Consumes: `DataContext` from `../../lib/ai/dataContext`; `useAiCompanion` from `./AiCompanion`.
- Produces: `Explainable({ context, children, className }: { context: DataContext; children: ReactNode; className?: string }): JSX.Element` — renders a focusable `role="button"` span with `aria-label="Explain: <label>"` that opens the companion on click and Enter/Space.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ai/Explainable.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiCompanionProvider } from "./AiCompanion";
import { Explainable } from "./Explainable";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [], severities: [], counties: [], causes: [],
  alcohol: null, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};
const ctx: DataContext = { kind: "chart", label: "Crashes by hour", series: [{ label: "5pm", value: 9 }], filters };

function setup() {
  render(
    <AiCompanionProvider>
      <Explainable context={ctx}><span>9</span></Explainable>
    </AiCompanionProvider>,
  );
}

describe("Explainable", () => {
  it("exposes an accessible explain button", () => {
    setup();
    expect(screen.getByRole("button", { name: "Explain: Crashes by hour" })).toBeTruthy();
  });

  it("opens the companion on Enter", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Explain: Crashes by hour" }), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "AI explanation" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ai/Explainable.test.tsx`
Expected: FAIL — cannot find module `./Explainable`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/ai/Explainable.tsx
import type { ReactNode } from "react";
import type { DataContext } from "../../lib/ai/dataContext";
import { useAiCompanion } from "./AiCompanion";

export function Explainable({
  context, children, className,
}: { context: DataContext; children: ReactNode; className?: string }) {
  const { open } = useAiCompanion();
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Explain: ${context.label}`}
      onClick={() => open(context)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(context);
        }
      }}
      className={`cursor-help underline decoration-dotted decoration-on-surface-variant/40 underline-offset-2 hover:decoration-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ai/Explainable.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ai/Explainable.tsx frontend/src/components/ai/Explainable.test.tsx
git commit -m "feat(ai): Explainable wrapper with affordance + a11y (P0 spine)"
```

---

## Task 8: Deep-tier "Go deeper with AI" wiring

**Files:**
- Modify: `frontend/src/components/ai/AiCompanion.tsx`
- Test: `frontend/src/components/ai/AiCompanion.deepdive.test.tsx`

**Interfaces:**
- Consumes: `useAskAi` from `../../hooks/useAskAi` (existing — `sendMessage(question: string)`, `messages`, `isLoading`).
- Produces: the companion renders a "Go deeper with AI" button that calls `sendMessage` with a context-derived question string built by a new exported pure helper `buildDeepDivePrompt(ctx: DataContext): string`.

> Keep the prompt builder pure and exported so it's unit-testable without rendering. The button wiring reuses the existing `useAskAi`; mock it in the test.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ai/AiCompanion.deepdive.test.tsx
import { describe, it, expect, vi } from "vitest";
import { buildDeepDivePrompt } from "./AiCompanion";
import type { DataContext } from "../../lib/ai/dataContext";

const filters = {
  years: [2023], severities: ["Fatal"], counties: ["kern"], causes: [],
  alcohol: true, distracted: null, pedestrian: null, cyclist: null, drug: null,
  driverAge: null, weather: [], lighting: [], collisionType: [], roadType: null, hitRun: null,
};

describe("buildDeepDivePrompt", () => {
  it("includes the label, value, and active filters", () => {
    const ctx: DataContext = { kind: "stat", label: "Fatality rate · Kern", measure: "fatality_rate", value: 1.5, geography: { type: "county", id: "15", name: "Kern" }, filters };
    const prompt = buildDeepDivePrompt(ctx);
    expect(prompt).toContain("Fatality rate · Kern");
    expect(prompt).toContain("1.5");
    expect(prompt).toContain("Kern");
    expect(prompt.toLowerCase()).toContain("2023");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ai/AiCompanion.deepdive.test.tsx`
Expected: FAIL — `buildDeepDivePrompt` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `frontend/src/components/ai/AiCompanion.tsx` (export the helper; wire a button into the dialog). First add the pure helper:

```tsx
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
```

Then, inside the dialog JSX in `AiCompanionProvider`, import and use `useAskAi` and render the button below the `<p>`:

```tsx
// add import at top:
// import { useAskAi } from "../../hooks/useAskAi";

// inside AiCompanionProvider, before return:
const { sendMessage, isLoading } = useAskAi();

// inside the dialog, after the <p> body:
<button
  onClick={() => current && sendMessage(buildDeepDivePrompt(current))}
  disabled={isLoading}
  className="mt-3 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-50"
>
  {isLoading ? "Thinking…" : "Go deeper with AI"}
</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ai/AiCompanion.deepdive.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full AI suite + typecheck**

Run: `cd frontend && npx vitest run src/lib/ai src/components/ai && npx tsc --noEmit`
Expected: all AI tests PASS, `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ai/AiCompanion.tsx frontend/src/components/ai/AiCompanion.deepdive.test.tsx
git commit -m "feat(ai): deep-dive prompt builder + Go deeper button (P0 spine)"
```

---

## Task 9: Mount the provider + prove it end-to-end on one number

**Files:**
- Modify: `frontend/src/main.tsx` (wrap the app in `AiCompanionProvider`)
- Modify: one existing stat-rendering component (e.g. `frontend/src/components/map/StatewideHeatmapCard.tsx`) to wrap a single number in `<Explainable>`
- Test: manual / existing suite regression

**Interfaces:**
- Consumes: `AiCompanionProvider` (Task 6), `Explainable` (Task 7), `statContext` + `snapshotFilters` (Task 2), `useFilterParams` (existing).

- [ ] **Step 1: Wrap the app**

In `frontend/src/main.tsx`, wrap the existing root tree with `<AiCompanionProvider>…</AiCompanionProvider>` (inside the Router/QueryClient providers so hooks resolve).

- [ ] **Step 2: Wrap one real number**

In the chosen component, build a context and wrap the rendered number:

```tsx
import { Explainable } from "../ai/Explainable";
import { statContext, snapshotFilters } from "../../lib/ai/contextBuilders";
import { useFilterParams } from "../../hooks/useFilterParams";

// inside the component:
const fp = useFilterParams();
// ...where the number renders:
<Explainable
  context={statContext({
    label: "Statewide fatal crashes",
    measure: "fatalities_per_100k",
    value: fatalCount,
    filters: snapshotFilters(fp),
  })}
>
  {fatalCount.toLocaleString()}
</Explainable>
```

- [ ] **Step 3: Typecheck + run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: `tsc` exits 0; all tests PASS (no regressions).

- [ ] **Step 4: Manual smoke (dev server)**

Run: `cd frontend && npm run dev` then open the page, click the wrapped number, confirm the companion opens with an instant explanation and a "Go deeper with AI" button.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/main.tsx frontend/src/components/map/StatewideHeatmapCard.tsx
git commit -m "feat(ai): mount AiCompanion + first Explainable number (P0 spine)"
```

---

## Self-Review

**Spec coverage (P0 scope of the design doc):**
- DataContext + frozen literal data → Task 1 ✅
- FilterSnapshot + builders → Task 2 ✅
- statNarrative percentile context → Task 3 ✅
- explainContext instant tier → Task 4 ✅
- `/api/stats/distribution` → Task 5 ✅
- AiCompanionProvider + surface → Task 6 ✅
- `<Explainable>` + a11y → Task 7 ✅
- Hybrid deep tier (Groq via useAskAi) → Task 8 ✅
- End-to-end mount + proof → Task 9 ✅
- (Full `narrativeEngine` chart integration, percentile wiring into the UI, and rollout across all surfaces are **P1**, by design.)

**Type consistency:** `DataContext`, `FilterSnapshot`, `ChartPoint`, `DistributionPoint`, `Explanation`, `StatNarrative`, `CompanionApi`, `buildDeepDivePrompt` are defined once and consumed with matching signatures across tasks. `useAiCompanion().open(ctx)` matches `Explainable`'s call. `statContext`/`snapshotFilters` signatures match their Task 9 usage.

**Placeholder scan:** No TBD/TODO; every code step shows real code; every test step has real assertions and a run command with expected result.
