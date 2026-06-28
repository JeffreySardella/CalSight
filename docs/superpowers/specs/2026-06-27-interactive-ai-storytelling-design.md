# Interactive AI Storytelling — Design Spec

> Status: design approved 2026-06-27. Scope: the full "interactive UI everywhere,
> woven through Ask AI" overhaul. One spec, **phased delivery** — each phase ships
> as its own reviewable PR. No single giant merge to the live prod site.

## 1. Goal

Turn CalSight from a dashboard you *read* into a data tool you *converse with*. Every
data element — a number, a chart mark, a county, a highway — becomes a launchpad to
understand it in context: an instant plain-language explanation, optional AI deep-dive,
and follow-up questions, all inline. Storytelling emerges from pervasive interactivity
rather than a single "story page." Users can pin what they find into shareable stories,
and the AI can reach across CalSight's cross-domain data (crashes × weather × census ×
environmental justice × economics × vehicles × infrastructure) to narrate correlations
no other crash tool surfaces.

### Success criteria
- Any stat number, chart element, county, or highway can be "explained" inline.
- The instant explanation is local (free, no spinner); AI deep-dive is opt-in.
- A user can pin AI answers/charts into a story and share it via deep link + OG image.
- The AI can answer cross-domain correlation questions and hedge causation.
- Nothing degrades the live site: graceful fallback when AI is rate-limited/unavailable.

## 2. Architecture — the Spine

All features are producers or consumers of **two new primitives**. Get these right and
every cluster is a thin plug-in.

### 2.1 `DataContext` (`frontend/src/lib/ai/dataContext.ts`)
A serializable descriptor of "what is this data element."

```ts
type DataContext = {
  kind: "stat" | "chart" | "county" | "highway" | "view" | "correlation";
  measure?: MeasureKey;                 // fatality_rate, per_100k, total_crashes…
  geography?: { type: "county" | "highway" | "state"; id: string; name: string };
  filters: FilterSnapshot;              // active years/severities/causes/flags
  value?: number;                       // literal value (for a stat)
  series?: ChartDataItem[];             // FROZEN literal data (for a chart)
  pair?: { x: DomainRef; y: DomainRef }; // for kind: "correlation"
  label: string;                        // "Fatality rate · Kern County · 2022–23"
};
```

**Critical decision:** AI- and chart-derived data is carried **literally** (`value`/`series`),
not as a re-query spec. This is the rock the earlier "Story Canvas" exploration hit:
`StoryReader` charts re-query from a dimension/measure spec, so they shift when filters
change. An explained number or a pinned AI chart must be **frozen** — it represents a
specific finding at a specific moment. `DataContext` is JSON-serializable so it round-trips
through URLs (deep links) and localStorage (canvas, thread).

### 2.2 `<Explainable>` + `useExplainable()` (`frontend/src/components/ai/Explainable.tsx`)
The one primitive that makes anything interactive. Wraps any element:

```tsx
<Explainable context={statContext}>
  <span>{formatRate(value)}</span>
</Explainable>
```

Responsibilities (built once, reused everywhere):
- **Affordance:** subtle dotted underline / info dot on hover; cursor change.
- **Accessibility:** focusable (`tabIndex`), `role="button"`, `aria-label`, Enter/Space
  activate, ESC closes. Centralizing a11y here is how we make "everywhere" accessible
  without per-surface effort.
- **Activate:** hands its `DataContext` to the `AiCompanionProvider`.

### 2.3 `AiCompanionProvider` + Companion surface (`frontend/src/components/ai/AiCompanion.tsx`)
React context holding companion state: open/closed, anchor element, current `DataContext`,
and the conversation `thread: ThreadEntry[]`. Renders the **Companion**:
- **Desktop:** popover anchored to the activated element.
- **Mobile:** bottom sheet.

The Companion is the single surface every cluster renders into.

### 2.4 Hybrid resolution (the cost/latency model)
Inside the Companion, two tiers:

- **Instant tier (local, free, no spinner):** `explainContext(ctx)` →
  - charts → extend existing `narrativeEngine.ts` (peaks/trends/anomalies)
  - single stats → new `statNarrative(ctx, distribution)` → percentile/rank/trend
  - correlations → local correlation math (Pearson r + plain-language strength/caveat)
- **Deep tier (Groq, on demand):** "Go deeper with AI" button and any follow-up call
  `useAskAi` with the `DataContext` injected into the prompt. Results cached by
  `(contextHash, question)`; throttled per-session for the public site.

This keeps the common case free and instant and only spends LLM budget when the user
explicitly wants more.

## 3. Feature Clusters (all consume the Spine)

### Cluster A — Explainable Everything *(foundation)*
- Wrap stat numbers, chart marks, counties, highways in `<Explainable>`.
- Instant local narrative + **percentile context** ("safer than 70% of CA counties").
- Auto "what this shows" **captions** on charts (passive `narrativeEngine` output).

### Cluster B — AI Companion *(continuous)*
- **Thread:** follow-ups carry accumulated `DataContext` across the whole app
  (click county → click chart → "compare them" knows both).
- **Command palette (Cmd/Ctrl-K):** global "ask anything"; answers in the Companion.
- **"Explain this view":** serialize current map/dashboard state → `DataContext{kind:"view"}`
  → one-click narrative of everything on screen.
- **NL build:** "alcohol crashes by hour in Kern as a heatmap" → builds chart/filters
  (extends existing `NlqQueryBar` / `nlqParser`).

### Cluster C — Story Canvas *(user-authored)*
- `pinned: DataContext[]` store. Every Companion answer has a **Pin** button → `/story` canvas.
- Drag to reorder; insert narrative text blocks between pins.
- **Share/export:** canvas serializes to a deep link + Markdown/PNG.
- **Shareable insight cards:** every explained insight gets its own deep link + **OG image**
  via the existing `workers/og-image` worker (this also repairs the broken social previews —
  `og.calsight.org` is currently NXDOMAIN; DNS fix is a separate chore, but the card
  generation lands here).
- **Embeddable:** `<iframe>` snippet for a pinned chart+narrative.

### Cluster D — Proactive AI *(it comes to you)*
- **Anomaly spotlights:** existing `anomaly.ts` / `AnomalyPanel` feed "crashes spiked 40%
  in X" cards into the Companion/card system.
- **Local briefing:** enter an area → AI-narrated safety story for it.
- **"Why?" drill chains:** each answer suggests 2–3 deeper follow-ups as chips.
- **"Surprise me":** one button → a random non-obvious insight (engagement/demos).

### Cluster E — Cross-Domain Story Intelligence *(the differentiator)*
The backend already has 13 AI tools spanning crashes, weather (NOAA), demographics
(Census), environmental justice (CalEnviroScreen), unemployment (BLS), EV/vehicle
registrations, and road/hospital infrastructure — but the dashboard uses almost none of it.

- **Correlation explorer:** pick any two domains → AI narrates the relationship + hedges
  causation: poverty × fatalities, rainfall/heat × crashes, environmental-justice score ×
  pedestrian deaths, unemployment × DUI, EV adoption × severity.
- **Weather stories:** "do crashes spike in rain or heat waves?" (NOAA data, currently invisible).
- **Equity lens:** CalEnviroScreen × crash outcomes — do disadvantaged communities bear
  more pedestrian/fatal crashes?
- **Golden-hour / hospital-access:** distance-to-hospital × fatality rate.
- **Demographic risk profiles:** party age/sex × outcomes, narrated.
- **Socioeconomic & infrastructure overlays:** unemployment, road miles, speed limits ×
  crash rates.
- **NL correlation:** "is there a link between poverty and pedestrian deaths?" → AI runs the
  cross-domain analysis live (`get_demographics` + `query_crashes` + correlation math).

### Plus — map-motion features (existing open issues)
- **Animated temporal heatmap** (#279): scrub crashes over time.
- **Crash-cluster / hotspot detection** (#280): spatial clustering surfaced as explainable cards.

## 4. Backend changes
Most AI tools already exist server-side; we mainly **expose** and **add a few**:
- `GET /api/stats/distribution?measure=…` — per-county values for percentile context
  (matview-backed for speed).
- `GET /api/correlation?x=…&y=…&geo=…` — cross-domain correlation pairs.
- Expose the unused domain endpoints (weather, environmental, vehicles) the dashboard never calls.
- Anomaly feed endpoint + OG-image generation for shareable insight cards.
- Inject `DataContext` into the Ask AI prompt (extend `ai_prompt.py` / `useAskAi` payload).

## 5. Data flow (single path, reused everywhere)
```
element → DataContext → Companion
   → instant tier: narrativeEngine / statNarrative / correlation calc   (local, free)
   → deep tier:    useAskAi + the 13 server tools                       (Groq, on demand, cached)
   → Pin → Story Canvas → deep link + OG card + embed
```

## 6. Phased delivery (one spec, many PRs)
Nothing giant hits prod. Each phase is independently shippable and reviewable.

- **P0 — Spine:** `DataContext`, `AiCompanionProvider`, `<Explainable>`, hybrid resolution,
  `statNarrative`, `GET /api/stats/distribution`. *No user-visible surfaces yet beyond a
  demo wrapping of one number.*
- **P1 — Cluster A:** wrap numbers/charts/counties/highways + percentile + auto captions.
- **P2 — Cluster B:** thread, Cmd-K palette, "explain this view," NL build.
- **P3 — Cluster C:** Story Canvas + insight cards + OG + embed.
- **P4 — Cluster D:** anomalies, local briefing, why-chains, surprise me.
- **P5 — Cluster E:** correlation explorer + cross-domain stories + NL correlation.
- **P6 — Map motion:** animated temporal heatmap (#279) + cluster detection (#280).

P0 must land first (everything depends on the spine). P1 should land before P2–P6 (they
assume `<Explainable>` is in place). P3–P6 are largely independent of each other.

## 7. Testing strategy
- **Unit:** `statNarrative` (percentile/rank/trend), correlation math, `DataContext`
  serialization round-trip, prompt injection.
- **Component:** `<Explainable>` affordance + a11y (keyboard, aria, ESC), Companion
  open/close/anchor, instant-tier render.
- **Integration:** Companion → `useAskAi` with context; cache + throttle behavior.
- **E2E (Playwright):** explain a number → go deeper → pin → canvas → share link resolves.
- **Backend (pytest):** `/api/stats/distribution`, `/api/correlation`, exposed domain
  endpoints, OG-card generation.

## 8. Risks & mitigations
- **LLM cost / rate limits on a public site** → hybrid (local-first) + response cache +
  per-session throttle; AI tier degrades to local narrative when unavailable.
- **Causation overclaiming** → existing prompt guardrails (`90773cc`, temp 0.4) + explicit
  correlation hedging in `statNarrative`/correlation output.
- **Stale/shifting data** → frozen literal `value`/`series` in `DataContext`; pinned
  insights never silently change.
- **Performance** → precomputed matviews for distribution/correlation; literal data avoids
  re-queries.
- **Accessibility regressions across "everywhere"** → centralized in `<Explainable>`,
  tested once.
- **Scope creep / unreviewable PRs** → strict phasing; P0–P6 each its own PR.

## 9. Out of scope (separate chores, not this spec)
- `og.calsight.org` DNS repair (NXDOMAIN) — config, not code (Cluster C consumes the worker
  once DNS is fixed).
- WCAG 2.2 AA full audit, methodology-footer copy, Spanish i18n, test-coverage backfill —
  tracked in `docs/DEFINITION_OF_DONE.md` / #322.

## 10. Open questions to resolve during planning
- Exact percentile basis: per-county distribution for the active filter set, or a fixed
  statewide baseline? (Leaning: active filter set, computed from `/api/stats/distribution`.)
- Companion thread persistence: session-only vs. saved to localStorage like the canvas.
  (Leaning: session-only for the thread; only *pinned* items persist, to keep the model
  simple and avoid stale long-lived threads.)
- Correlation endpoint: precompute common pairs vs. compute on demand with caching.
  (Leaning: compute on demand with a response cache keyed by `(x, y, geo, filters)`;
  promote to a precomputed matview only if latency demands it.)
