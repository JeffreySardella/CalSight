# CalSight — a one-page case study

*Written 2026-09-13, updated 2026-09-21 after a second feature wave. Crash
totals are from production on 2026-09-13; PR and commit counts are current
as of the update.*

## What it is

[calsight.org](https://calsight.org) is a public explorer for every reported
California traffic crash since 2001: **11.6 million crashes**, ~9 million
parties, 6.5 million victims, joined to weather, demographics, road inventory,
equity indices, and a water-conditions module. Map, stats dashboard builder,
a streaming plain-English "Ask AI", pre-computed per-county AI narratives, and
a printable per-county report card. Started 2026-03-26; live since May;
**276 merged PRs, 883 commits** as of this writing.

## Stack, and why

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite, Leaflet, hand-rolled SVG charts | No chart library could do the 12 chart types with one theming system; SVG kept the bundle small and the PNG export honest |
| API | FastAPI + SQLAlchemy 2.0, Python 3.12 | Async, typed, trivial to test; every endpoint has a cache header |
| Database | PostgreSQL 17, 10 materialized views, 138 indexes | 11.6M rows fit one box; matviews turned 8-second aggregates into 50 ms |
| ETL | 30 jobs across 12 providers, APScheduler in a container | Idempotent upserts, retries with backoff, skip-on-upstream-5xx so one dead CKAN endpoint never fails the night |
| AI | Groq gpt-oss-120b → Gemini → OpenRouter fallback chain | Narratives are generated at ETL time and number-checked against SQL before publishing; the request path never blocks on an LLM |
| Hosting | Cloudflare Pages + Proxmox at home (LXC for Postgres, VM for API), Cloudflare tunnel, R2 for backups | Started on Azure, moved home when the monthly bill was the only thing the cloud was buying |

## Engineering that mattered

- **Trust the DOM, not the screenshot.** A polish audit shipped a "fixed"
  mobile layout that a real browser pass proved was still broken. Every UI fix
  since has been verified in a real browser against the accessibility tree —
  a September mobile-map fix (heat aggregation, tap-to-zoom, a deferred
  service-worker update) came from testing an actual link the owner sent
  from their phone, not a simulated viewport.
- **The fabricated-YoY bug family.** Three separate surfaces compared a
  partial current year against a full prior year and published −50% to −64%
  county "declines". Fix was one rule applied everywhere: exclude any year
  under a coverage threshold from every comparison. A later audit found the
  same class again in the AI insight cards; the ETL now regenerates any card
  whose underlying stats changed and verifies every number the LLM writes.
- **The over-claiming kept recurring.** A September audit checked all ten
  Stats-page data stories against production: five had the wrong number,
  three had none — a "3.1x" that was really 4.1x, a correlation stated as
  0.52 that was 0.14. The same week, a causal-language gate that had only
  ever checked the AI fun facts was extended to the county narratives after
  one asserted a cause SWITRS records can't support, and then needed its own
  fix so it stopped rejecting honest sentences — a crash-outcome tally like
  "52.1% resulted in no injuries" is descriptive, not causal. Same root
  cause each time: nothing had checked what got published against what the
  data actually said.
- **SWITRS 2001 was short 211k crashes for months.** Case IDs from that year
  overflowed `bigint` and were silently dropped. Folding the IDs recovered
  them and moved the statewide total from 11.34M to 11.60M.
- **A pipeline container crash-looped for weeks (257 restarts) without anyone
  noticing.** That is what drove the observability work: Discord alerts on
  every ETL run and uptime probe, and a healthchecks.io dead-man's switch on
  the nightly backup. Alerts now fire before a human would look.
- **Restore drill, measured.** The offsite dump restores into a fresh
  Postgres in **3 min 18 s** with zero errors and an exact row-count match.
  RTO is a number, not a belief.
- **Migration ID collisions bit three times** and Alembic reported each as a
  "cycle". A tiny test now walks the migration graph in CI.
- **Where the CSS cascade really loads.** Third-party overrides worked in dev
  and lost in prod because the lazy-loaded chunk's stylesheet arrives last.
  Repeating the selector to raise specificity was the whole fix.

## Data honesty

The site's own methodology doc once advertised statistical tests that did not
exist in the code. An 82-agent audit found that and a dozen smaller
over-claims; all were corrected or deleted. Every "rate" now names its
denominator, correlations are labelled associations, and the About page reads
its totals live from the API instead of hard-coding them.

## The finding worth telling

From 2019 to 2022 California crashes fell 15% while deaths rose 23%. Roads did
not get busier; crashes got deadlier. 2025 is the first full year deaths fell
below pre-pandemic levels. The data supported a story the site was not
telling, and that reframed the product more than any feature did.

## What it cost

One maintainer, six months of evenings, a used mini PC, and about $5/month
in Cloudflare. It now runs unattended and pages the maintainer only when
something is actually wrong.
