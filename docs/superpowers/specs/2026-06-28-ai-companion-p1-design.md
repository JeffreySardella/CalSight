# AI Companion P1 — Inline Deep-Dive + County Percentile Tier — Design

**Date:** 2026-06-28
**Status:** Approved (design); spec pending user review
**Feature area:** AI Companion (`AiCompanion.tsx`), StatsPage, `/api/stats/distribution`

## Summary

Two P1 follow-ups to the P0 AI storytelling spine, both improving the AI Companion popover:

1. **Inline deep-dive** — after "Go deeper with AI", render the AI answer *inside* the popover instead of silently dropping it into `useAskAi`'s sessionStorage (only viewable on `/ask`).
2. **County percentile tier** — wire the already-built `GET /api/stats/distribution` endpoint into the instant tier so a county-scoped stat shows "ranks #N of 58 — safer than X%". Includes a live demo on StatsPage when exactly one county is selected.

This closes the two headline gaps the P0 whole-branch review flagged and advances issue #306 (distribution UI wiring) and #305 (analytical credibility).

## Background (current state)

- `AiCompanion.tsx` renders a small bottom-right popover. "Go deeper" calls `sendMessage(buildDeepDivePrompt(current))` on the provider's **own** `useAskAi` instance. The response lands in that instance's `messages` (+ shared sessionStorage) but is **not rendered**.
- `explainContext(ctx, { distribution })` already has a `kind:"stat"` percentile path (via `statNarrative`), but `distribution` is never supplied, so stats fall through to the placeholder.
- `GET /api/stats/distribution?metric=&year=` returns `[{ county_code:int, county_name:string, value:number }]`; valid metrics: `crash_count, total_killed, total_injured, fatal_crashes, alcohol_crashes, pedestrian_crashes` (422 otherwise).
- `statNarrative` matches the subject by `DistributionPoint.id === subjectId` and computes rank/percentile.
- The StatsPage demo wraps statewide `totalIncidents` with `measure:"crashes_total"` and **no** geography — semantically not a percentile subject.

## Part A — Inline deep-dive answer

### Behavior
- Add local state `askedHere: boolean`, set `true` on "Go deeper" click; reset to `false` whenever `current` changes (new number opened) or the popover closes. This ensures the popover shows **only the answer from this dialog session**, never stale `/ask` history that shares sessionStorage.
- Below the "Go deeper" button, when `askedHere`, render an answer region:
  - `isLoading` → a small "Thinking…" line.
  - `error` (from `useAskAi`) → the error text + the existing `retry` button.
  - otherwise → the **latest assistant message** (`messages.filter(m => m.role === "assistant").at(-1)`), rendered with `ReactMarkdown` for `content` and `InlineChart` for `chart` (the same primitives chat uses — no feedback/pin chrome).
- The region is `max-h-[40vh] overflow-y-auto` and wrapped in `aria-live="polite"` so it scrolls and is announced to AT.

### Source of state
The provider already calls `useAskAi()`; extend the destructure to `{ sendMessage, isLoading, error, retry, messages }`. No new fetch path; the hybrid-tier invariant (no API call until the button) is preserved — `askedHere` only gates *rendering*, and the existing invariant test continues to assert `sendMessage` fires only on click.

## Part B — County percentile tier

### `useDistribution(metric, year, options)`
New `frontend/src/hooks/useDistribution.ts` — a react-query hook (matching existing hook/query patterns in the repo) that:
- Fetches `GET ${API_BASE}/api/stats/distribution?metric={metric}&year={year?}`.
- Accepts `{ enabled?: boolean }`; when disabled, does not fetch.
- Returns adapted `DistributionPoint[]` (see adapter).
- Query key includes `metric` and `year`.

### Adapter — match by name, not code
The frontend selects counties by **name**, not by `county_code`. So the adapter maps each endpoint row to:
```ts
{ id: normalizeCounty(row.county_name), name: row.county_name, value: row.value }
```
where `normalizeCounty(s) = s.trim().toLowerCase()`. The subject's `geography.id` is built with the **same** `normalizeCounty`, so `statNarrative`'s `id === subjectId` match works without the client knowing county codes.

### `measureToMetric(measure: string): DistributionMetric | null`
New `frontend/src/lib/ai/measureMetric.ts`:
```ts
type DistributionMetric = "crash_count" | "total_killed" | "total_injured"
  | "fatal_crashes" | "alcohol_crashes" | "pedestrian_crashes";
```
Maps known measure strings to a metric; returns `null` for anything else (e.g. `crashes_total`, rates). `normalizeCounty` also lives here (or a small shared util) so the adapter and the demo share one implementation.

### Provider wiring (`AiCompanion.tsx`)
- Derive, from `current`:
  - `metric = current?.kind === "stat" ? measureToMetric(current.measure) : null`
  - `isCounty = current?.geography?.type === "county"`
  - `year` = the single selected year if `current.filters.years.length === 1`, else `null` if `current.filters.years.length === 0`, else the tier is disabled (see guard).
  - `distEnabled = current?.kind === "stat" && isCounty && metric != null && current.filters.years.length <= 1`
- Call `const { data: distribution } = useDistribution(metric ?? "crash_count", year, { enabled: distEnabled })` (metric falls back to a valid default when disabled so the URL is always well-formed; `enabled` prevents the fetch).
- Compute `explanation = current ? explainContext(current, { distribution: distEnabled ? distribution : undefined }) : null`.

**Year guard rationale:** the endpoint computes one specific year or all years. A multi-specific-year filter (e.g. 2020+2021) would make the subject value and the distribution disagree, producing a dishonest percentile. So multi-year selections disable the distribution tier and fall back to the existing placeholder/chart tier.

### Live demo (`StatsPage.tsx`)
When exactly one county is selected (`selectedCounties.size === 1`), build the `totalIncidents` Explainable context as county-scoped:
- `label: "Total crashes · {CountyName}"`
- `measure: "crash_count"`
- `geography: { type: "county", id: normalizeCounty(countyName), name: countyName }`
- `value: totalIncidents`

Otherwise (statewide / multi-county) keep the current context (`label:"Total crashes statewide"`, `measure:"crash_count"`, no geography). (Change `crashes_total` → `crash_count` so the measure is a real metric; statewide still won't fetch because it has no county geography.)

`countyName` comes from the single entry of `selectedCounties`. The demo uses `normalizeCounty` from `measureMetric.ts` for the id.

## Error Handling
- Deep-dive: `useAskAi` errors surface inline with `retry` (Part A). A rejected fetch never crashes the popover.
- Distribution: if `useDistribution` errors or returns empty, `explainContext` receives no usable `distribution` and falls back to the existing tier (placeholder/chart) — no error shown for the instant tier (it's best-effort enrichment).

## Non-Goals (YAGNI)
- Not tightening `DataContext.measure` from `string` to a union (cross-file churn; `measureToMetric` guards the mapping).
- No streaming of the deep-dive answer; no chart export from the popover.
- No new distribution metrics beyond the six the endpoint already supports.

## File Summary
New:
- `frontend/src/hooks/useDistribution.ts` (+ test)
- `frontend/src/lib/ai/measureMetric.ts` (`measureToMetric`, `normalizeCounty`, adapter helper) (+ test)

Modified:
- `frontend/src/components/ai/AiCompanion.tsx` — inline answer region + distribution wiring
- `frontend/src/pages/StatsPage.tsx` — county-scoped context when 1 county selected

## Testing (TDD)
- `measureToMetric`: known measures map; unknown → null. `normalizeCounty`: trim/lowercase. Adapter: endpoint rows → `{id,name,value}` with normalized id.
- `useDistribution`: builds correct URL with/without year; returns adapted points; does not fetch when `enabled:false` (mock fetch).
- `AiCompanion` (mock `useAskAi`):
  - does NOT render an answer before "Go deeper" even if `messages` has stale history;
  - after clicking, renders the latest assistant message (markdown);
  - shows "Thinking…" while `isLoading`, and error + retry when `error`;
  - the existing hybrid-invariant test still passes (no `sendMessage` on open).
- `AiCompanion` distribution enablement: with a county stat + mappable measure + ≤1 year, `explainContext` gets a distribution and the percentile narrative renders; with multi-year or no geography, it falls back (assert via the rendered body text).
- `StatsPage`: one county selected → context has county geography + `crash_count`; statewide → no geography.
