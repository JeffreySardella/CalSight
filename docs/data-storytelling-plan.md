# CalSight — Data Storytelling Plan

**Created:** 2026-07-02. **Branch:** `claude/data-storytelling`.
**Companion to:** `docs/feature-data-roadmap.md` (the researched *what to build*). This doc is the
*how we tell the story* — it maps each new data point / analytical feature to a **narrative** and
to the **specific storytelling surface** CalSight already has, so new data lands as a story, not a
chart nobody reads.

> Status: research + outline (first pass). Each theme below is a candidate narrative; copy is
> illustrative. Before shipping any number in a narrative, wire it to a deterministic query (see
> "Data dependency") — CalSight's existing rule is that stats are computed at ETL time and the LLM
> only *phrases* them, never invents them.

---

## 1. The storytelling surfaces we already have (the "slots")

Any new data point should target one or more of these — we are not inventing new UI, we are
*feeding* existing narrative machinery.

| Surface | Where | What it is | Good for |
|---|---|---|---|
| **County insight card** | Map → click a county (`AiInsightCard`) | Deterministic county stats + a 2–3 sentence LLM narrative (`etl/generate_insights.py` → `county_insights` → `/api/insights/{slug}`) | Per-place "what's the story here" |
| **Statewide insights (angles)** | Home / stats (`StatewideInsight`, has an `angle` field) | Rotating statewide takeaways, each with an editorial *angle* | Punchy, shareable statewide facts |
| **Graded county cards** | `CountyInsightCard` (generated → judged → graded: `judge_insight_cards.py`, `grade_insight_cards.py`) | Quality-scored insight cards | Curated, trustworthy county narratives |
| **Data Stories** | Stats → `StoryReader` (`lib/dashboard/stories`, `DataStory`/`StoryBlock`/`ChartBlock`) | Curated, *filter-aware* sequences of prose + charts with a `StoryContext` | Guided, multi-chart narratives |
| **Per-chart narrative** | `InsightBanner`, `ChartNarrative`, `NarrativePanel` | Auto one-liner explaining a chart | Turning every chart into a sentence |
| **AI conversational report** | Ask AI → `StoryCanvasPanel` / `StoryReportView` | LLM-built report from a conversation | On-demand, user-driven stories |

**Design rule for all of it:** *deterministic number → editorial framing.* The LLM/prose layer
makes it engaging; the number is always queryable and reproducible. Keep that separation for every
new data point below.

---

## 2. Narrative themes (data → story → surface)

Organized by *story*, not by dataset — that's how a reader experiences it. Each theme names the
data it needs, the audience it serves, the surface it plugs into, and an illustrative beat.

### Theme A — "Where the danger actually concentrates" (High-Injury Network) ⭐ flagship story
- **The hook:** a tiny fraction of roads carries most of the harm. Leading cities find **~7–8% of
  street mileage accounts for ~65–67% of deaths & severe injuries.** For a Californian this
  reframes safety from "my county's number" to "*these specific streets near me*."
- **Audience:** all three — public ("the 3 deadliest corridors in your city"), advocates (the
  Vision-Zero prioritization list), personal ("is a High-Injury street on my commute?").
- **Surface:** new **corridor/intersection story** on the map + a **Data Story** ("California's
  High-Injury Network") + county insight card line ("68% of this county's severe crashes happen on
  just 6 corridors").
- **Data dependency:** geocoded SWITRS points + severity/VRU-weighted segment scoring (roadmap A3).
- **Beat:** *"You don't live in a dangerous county. You live near a dangerous half-mile. Here it is."*

### Theme B — "The undercount" (hospital vs. police data) ⭐ highest-novelty story
- **The hook:** police reports miss **25–56% of pedestrian** and **54–93% of bicyclist** injury
  crashes vs. hospital records. Every crash map (including CalSight-as-is) *undercounts the most
  vulnerable people.* Naming that is a trust-builder no free CA tool foregrounds.
- **Audience:** journalists (a story in itself), advocates (justifies investment), public (honesty).
- **Surface:** an **honesty banner** (`InsightBanner`) on any ped/bike view; a statewide-insight
  angle ("What the crash data can't see"); a methodology callout.
- **Data dependency:** ships as a *caveat* immediately (cite the studies); upgrades to a real layer
  if HCAI/EMSA county-aggregate injury data is obtainable (roadmap D1 — confirm public access).
- **Beat:** *"For every bicyclist injury in this map, as many as 13 never made it into police data."*

### Theme C — "Exposure honesty: rates that don't lie" (per-VMT, done right)
- **The hook:** raw counts favor big counties; naive per-capita favors rural ones; and even
  per-VMT is misleading because **crashes scale *sublinearly* with traffic** (safety in numbers).
  CalSight can be the site that normalizes *correctly* and says so.
- **Audience:** advocates/researchers (credibility), journalists (the "actually, the real
  ranking is…" angle).
- **Surface:** a toggle on the correlation matrix / rankings ("normalize by: population · VMT ·
  road miles · statistically-adjusted") with a `ChartNarrative` explaining what changed and why.
- **Data dependency:** county VMT (vetted backlog) + the sublinear model / SPF (roadmap A2).
- **Beat:** *"By raw count, LA looks worst. Per mile driven, the ranking flips — here's who's
  actually most dangerous to travel through."*

### Theme D — "Did it work?" (countermeasures / before-after)
- **The hook:** overlay safety projects (road diets, speed humps, signals) on crashes and show the
  trend before vs. after — the single most persuasive civic-safety story.
- **Audience:** advocates & city staff (accountability), journalists (outcomes).
- **Surface:** a **countermeasure overlay** on the map + an auto "before/after" `ChartNarrative`.
- **Data dependency:** Caltrans SHOPP / local Vision-Zero project layers (roadmap D3). **Guardrail:**
  frame as *association, not proof* — one intersection is an anecdote, not a study.
- **Beat:** *"Two years after this corridor got a road diet, severe injuries fell 40%."* (with the
  honest asterisk).

### Theme E — "Your commute / your intersection" (personal risk)
- **The hook:** the consumer entry point — search an address/route and get its crash history and
  a risk read, with *when* (time-of-day/day-of-week) it's most dangerous.
- **Audience:** the general public (this is the shareable, viral surface).
- **Surface:** a new address/route search result → an **AI conversational report**
  (`StoryReportView`) summarizing "your intersection."
- **Data dependency:** geocoded points + intersection rollups (roadmap F1) + optional route-risk
  scoring (A4). **Guardrail:** history-only risk omits behavior/real-time conditions — say so.
- **Beat:** *"The intersection by your house: 23 crashes in 5 years, worst on Friday evenings."*

### Theme F — "Who bears the harm" (equity)
- **The hook:** cross crash severity with CalEnviroScreen / income / demographics (CalSight already
  has these) to tell the equity story — harm isn't evenly distributed.
- **Audience:** advocates, journalists, public.
- **Surface:** statewide-insight angle + a Data Story ("The uneven geography of harm").
- **Data dependency:** already in hand (CalEnviroScreen + ACS + crashes); this is a *framing*
  upgrade, not new data. **Guardrail:** correlation ≠ causation; avoid deficit framing of
  communities.
- **Beat:** *"Severe pedestrian crashes are concentrated in the neighborhoods with the fewest
  resources to fix them."*

### Theme G — "What changed this year" (trends & anomalies, AI-narrated)
- **The hook:** auto-detected movers — "X entered the high-injury network," "DUI crashes up 18% in
  county Y." Turns the database into a *newsroom feed*.
- **Audience:** journalists (leads), public (freshness), advocates (early warning).
- **Surface:** statewide insights + county cards + an "anomalies" strip; powered by the existing
  insight-generation ETL.
- **Data dependency:** existing crashes + anomaly detection on trends (roadmap A5). **Guardrail:**
  small-county noise → use significance/shrinkage before calling something a "spike."
- **Beat:** *"Three counties saw statistically significant jumps in fatal crashes this year."*

---

## 3. Cross-cutting storytelling guardrails (bake into the prose layer)

These are *editorial constraints* enforced wherever narratives are generated
(`generate_insights.py` prompt, Data Story copy, AI reports):

1. **Deterministic-number rule** — the LLM phrases numbers it's given; it never estimates. (Already
   CalSight's design; extend it to every new metric.)
2. **Re-identification safety** — crash victims are highly re-identifiable (relative risk ~537×;
   up to ~67% for hospitalized-with-permanent-injury). For fatal/severe records, **never let a
   narrative combine precise location + exact date + victim detail.** Story at the corridor/
   intersection/aggregate level, not the person level.
3. **Causation honesty** — "associated with," not "caused by," especially for Themes C, D, F.
4. **Undercount transparency (Theme B)** — VRU narratives carry the undercount caveat.
5. **Small-number discipline** — 5 tiny counties swing wildly; require a minimum denominator (or
   EB shrinkage) before a narrative makes a superlative claim.

---

## 4. Suggested first stories to ship (impact-per-effort)

Pairs with the roadmap's Tier-1/Tier-2 so *data* and *story* land together:

1. **"California's High-Injury Network"** Data Story + map corridors (Theme A) — flagship, uses
   data in hand (geocoded points). Highest impact.
2. **"What the crash data can't see"** honesty banner + statewide angle (Theme B) — near-zero data
   cost (ships as a cited caveat), high trust/journalism payoff.
3. **Intersection "your commute" report** (Theme E) — the consumer/viral surface; reuses the AI
   report view.
4. **"Rates that don't lie" normalization toggle + narrative** (Theme C) — pairs with the VMT
   backlog item; the credibility differentiator vs. TIMS.

---

## 5. Open questions (for the owner)

1. **Voice/brand:** how opinionated should narratives be — neutral explainer, or a Vision-Zero
   "these deaths are preventable" stance? (Changes copy across every surface.)
2. **Person-level detail:** do we ever want to surface individual fatal crashes (memorial-style,
   like some Vision Zero sites), or stay strictly aggregate? (Drives the §3.2 privacy line.)
3. **HCAI/EMSA access:** is there appetite to pursue a data-use agreement for hospital injury data,
   or should Theme B stay a cited-caveat story for now?
4. **Cadence:** should the "what changed this year" feed (Theme G) be annual (matches ETL) or
   move toward more frequent updates?

---

## Sources
See `docs/feature-data-roadmap.md` for the full cited source list (SafeTREC/TIMS, Boston MPO HIN,
FHWA HSM, Portland & NYC Vision Zero, injury-underreporting and re-identification studies).
