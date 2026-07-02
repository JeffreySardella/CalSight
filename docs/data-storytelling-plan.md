# CalSight — Data Storytelling Plan

**Created:** 2026-07-02. **Branch:** `claude/data-storytelling`.
**Companion to:** `docs/feature-data-roadmap.md` (the researched *what to build*). This doc is the
*how the data gets presented* — mapping each new data point / feature to the **building blocks** a
user composes their own story from, on the narrative surfaces CalSight already has.

---

## 0. Product philosophy (read this first — it constrains everything below)

**CalSight presents; it does not argue.** The whole idea is that *the user* builds the story.
CalSight's job is to offer the data in **many different ways** — cuts, normalizations, overlays,
chart types, scopes — and let the user **choose how to present it** and what to make of it.

Two principles follow, and every item in this doc obeys them:

1. **Neutral voice, always.** Factual, plain, non-persuasive. We describe *what the data shows*,
   never *what should be done about it*. No advocacy framing, no "these are preventable," no
   editorializing adjectives ("shocking," "alarming"). A caption states the number and the cut;
   the reader supplies the meaning.
2. **Optionality over opinion.** Value comes from *breadth of ways to look*, not from a single
   curated takeaway. Each "theme" below is really **a lens the user can turn on, combine, and
   arrange** — not a story CalSight tells them.

This is the opposite of the typical Vision-Zero dashboard, which pushes an agenda. CalSight is the
neutral instrument: same data, presented every reasonable way, user-composed.

---

## 1. The surfaces users compose with (the building blocks)

New data should feed these existing surfaces — we're adding *ingredients*, not new machinery. Note
how many are already **user-driven** (they pick the filter, build the dashboard, ask the question):

| Surface | Where | User's role | Neutral by design? |
|---|---|---|---|
| **Filters + chart breakdowns** | Stats / map | User chooses the cut (year, cause, severity, mode, place, time) | Yes — user picks the slice |
| **Dashboard builder** | Stats (advanced mode) | User assembles their own set of charts | Yes — user composes |
| **Data Stories** | `StoryReader` (`DataStory`/`StoryBlock`) | Curated *sequences* of prose + charts, filter-aware | Keep prose descriptive, not persuasive |
| **County insight card** | Map click (`AiInsightCard` → `county_insights`) | Auto stats + short LLM narrative | Neutralize the prompt (see §3) |
| **Statewide insight angles** | `StatewideInsight.angle` | Rotating statewide facts | Each "angle" = a neutral cut, not an opinion |
| **Per-chart narrative** | `InsightBanner` / `ChartNarrative` | Auto one-liner describing a chart | Describe the pattern, don't interpret it |
| **AI conversational report** | Ask AI (`StoryReportView`, `StoryCanvasPanel`) | User asks; AI assembles a report from real tools | User drives; AI reports, doesn't advise |

**The through-line:** the user is already the author on most surfaces. New data just gives them
**more ways to slice and present** — more normalizations, more overlays, more scopes — while the
prose layer stays a neutral describer.

---

## 2. Presentation lenses (data → the ways a user can present it)

Reframed as *options the user turns on and combines*, not conclusions. For each: what new way of
looking it unlocks, which surface it feeds, the data it needs, and a **neutral** example caption.

### Lens A — Geographic scope: county → corridor → intersection
- **New way to look:** today the finest neutral geographic cut is county choropleth + raw dots. Add
  **corridor and intersection** as scopes the user can select, so crashes can be aggregated and
  ranked at street level, not just county level.
- **Feeds:** map scope selector; a "by intersection / by corridor" breakdown on Stats; an optional
  Data Story block.
- **Data dependency:** geocoded SWITRS points + segment/intersection aggregation (roadmap A3/F1).
- **Neutral caption:** *"Crashes aggregated by intersection, 2019–2023. Ranked by count."* (No
  "deadliest" — the user sorts and draws their own conclusion.)

### Lens B — Normalization: let the user choose the denominator
- **New way to look:** a **"normalize by"** control — raw count · per capita · per VMT · per road
  mile · statistically-adjusted (SPF/EB). The *user* picks the denominator; the ranking changes and
  they see how. Include a plain note that per-VMT is sublinear so different denominators tell
  different stories — stated as a fact about the math, not a recommendation.
- **Feeds:** correlation matrix + rankings toggle; `ChartNarrative` states which denominator is
  active and what changed.
- **Data dependency:** county VMT (backlog) + road miles (have) + SPF (roadmap A2).
- **Neutral caption:** *"Ranked by crashes per 100M vehicle-miles. Switch denominator above to
  re-rank."*

### Lens C — Mode: pedestrian / bicycle / motorcycle as first-class cuts
- **New way to look:** dedicated mode filters/views so a user can isolate the road users they care
  about — matching the mode breakdowns leading tools expose.
- **Feeds:** map + stats filters; mode-specific Data Story blocks.
- **Data dependency:** already in SWITRS party/victim data; presentation upgrade. Pair with the
  **undercount note** (Lens G).
- **Neutral caption:** *"Pedestrian-involved crashes only, by hour of day."*

### Lens D — Time: trends, seasonality, timelapse, "as-of" windows
- **New way to look:** more temporal cuts — weekly/seasonal patterns, multi-year windows the user
  sets, and the existing timelapse. Let the user frame the period.
- **Feeds:** stats presets; timelapse; `ChartNarrative` describing the trend direction factually.
- **Data dependency:** in hand.
- **Neutral caption:** *"Fatal crashes by year, 2001–2024. Trend line: linear fit."*

### Lens E — Context overlays: infrastructure, projects, environment
- **New way to look:** optional map layers the user toggles — roadway type/facility class, safety
  projects/countermeasures, CalEnviroScreen/demographics — so they can overlay context and judge
  relationships themselves. **Present the overlay; never assert it caused anything.**
- **Feeds:** map layer toggles; the correlation matrix (already the "compare against a factor" tool).
- **Data dependency:** Caltrans roadway GIS (D2), countermeasure layers (D3), env data (have).
- **Neutral caption:** *"Crash locations with Caltrans safety projects (2018–present) overlaid.
  Overlap is shown, not attributed."*

### Lens F — Place-level lookup: "this address / intersection / route"
- **New way to look:** the user searches a place and gets its crash history presented neutrally —
  counts, severity split, when. A self-serve "look up any spot" tool, not a risk verdict.
- **Feeds:** search → AI report (`StoryReportView`) or a place card.
- **Data dependency:** geocoded points + intersection rollups (F1); route-risk (A4) optional and,
  if shown, labeled as history-based only.
- **Neutral caption:** *"This intersection: 23 crashes, 2019–2023 — 3 severe, 20 minor. By day of
  week below."*

### Lens G — Data-limitation notes: make the caveats a presentable layer
- **New way to look:** surface the *known limits* of the data as optional, factual context the user
  can read — e.g., police reports undercount pedestrian/bicyclist injuries (cite the range), SWITRS
  vs. hospital coverage. This is neutral transparency, not advocacy.
- **Feeds:** `InsightBanner` methodology note; an "about this data" panel.
- **Data dependency:** citations now; optional HCAI/EMSA aggregate layer later (D1).
- **Neutral caption:** *"Note: police-reported data is known to undercount bicyclist injuries
  (studies estimate 7–46% captured). Counts here reflect police reports only."*

---

## 3. Neutral-voice rules (enforce wherever prose is generated)

Applies to the `generate_insights.py` prompt, Data Story copy, `ChartNarrative`, and AI reports:

1. **Describe, don't prescribe.** State the number, the cut, and the observed pattern. Never
   recommend an action or imply blame. ("X by hour peaks at 6pm," not "dangerous evening rush.")
2. **No loaded adjectives.** Drop "alarming / shocking / deadly / worst." Use plain comparatives
   the user can verify ("highest count among the selected counties").
3. **Deterministic numbers only.** The LLM phrases stats it's handed; it never estimates or infers
   causes. (Already CalSight's rule — keep it.)
4. **Association, not causation.** For any overlay/correlation (Lens B/E), the prose says
   "associated with / co-occurs with," never "causes / because of."
5. **Re-identification safety.** Crash victims are highly re-identifiable. For fatal/severe records,
   never present precise location + exact date + victim detail together; keep person-level data
   aggregated to corridor/intersection/period. (This is a hard rule, independent of voice.)
6. **Small-number discipline.** Require a minimum denominator (or EB shrinkage) before any
   superlative or ranking claim; otherwise present with an uncertainty note.

**Prompt change to make first:** the current county-insight prompt says *"Be engaging — mix one
surprising comparison or fun fact with the key trend."* Under the neutral philosophy that should
become something like *"Write 2–3 plain, factual sentences describing the most notable patterns in
the data. Neutral tone; no recommendations, no loaded adjectives, no causal claims."*

---

## 4. Suggested first building blocks to ship (impact-per-effort)

1. **Intersection/corridor scope (Lens A)** — the biggest new *way to look*, from data in hand.
2. **"Normalize by" control (Lens B)** — pure optionality; lets users re-rank however they want.
3. **Neutralize the insight/narrative prompts (§3)** — small change, aligns existing prose with the
   philosophy immediately.
4. **Data-limitation notes layer (Lens G)** — near-zero cost, high trust, purely factual.

---

## 5. Open questions (for the owner)

1. **Person-level detail:** do you ever want to surface individual fatal crashes (some sites do
   memorial-style), or stay strictly aggregate? Drives the §3.5 privacy line. (Default read from
   your neutrality: **stay aggregate**.)
2. **HCAI/EMSA hospital data:** pursue a data-use agreement for injury data (Lens G upgrade), or
   keep the undercount as a cited note for now?
3. **AI report guardrails:** the conversational report (`StoryReportView`) is user-driven — should
   it be allowed to *summarize/compare* freely, as long as it never recommends or claims causation?
   (Assumed yes, within the §3 rules.)

*(Voice question resolved: strictly neutral, present-don't-persuade, user-composed.)*

---

## Sources
See `docs/feature-data-roadmap.md` for the full cited source list.
