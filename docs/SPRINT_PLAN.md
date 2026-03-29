# CalSight Sprint Plan

**Team:** 3 people × ~10 hrs/week = 30 hrs/week
**Sprint length:** 2 weeks (60 person-hours per sprint)
**Start date:** Week of 2026-03-31

---

## Sprint 1: Fix Bugs + Backend Foundation (60 hrs)

Goal: Fix all P0 bugs, get the backend database and config ready, merge the redesign.

| # | Issue | Est | Assignee | Track |
|---|-------|-----|----------|-------|
| #35 | Fix NavBar: remove Sign In/bell, fix hex tokens | 2h | Frontend | FE |
| #36 | Fix broken Material Symbol icons | 1h | Frontend | FE |
| #37 | Remove border violations from About page | 1h | Frontend | FE |
| #38 | Sidebar panel open/close animation | 3h | Frontend | FE |
| #59 | Demographics: missing time-of-day + age groups | 3h | Frontend | FE |
| #60 | Ask AI: fix readOnly input, wire guided topics | 3h | Frontend | FE |
| #61 | Stats: PEAK label, hover, chip handlers | 3h | Frontend | FE |
| #67 | AI Insight card: fix shadow classes | 1h | Frontend | FE |
| #62 | Complete 58-county list in Filters | 2h | Frontend | FE |
| #63 | Wire all sidebar panel buttons | 3h | Frontend | FE |
| #64 | About page: add Learn More links | 1h | Frontend | FE |
| #83 | Docker: verify docker-compose works | 3h | Infra | BE |
| #70 | Backend: CORS, env vars, config | 4h | Backend | BE |
| #69 | Database schema + Alembic migrations | 8h | Backend | BE |
| #66 | Backend: DB models, ORM, SQLAlchemy | 6h | Backend | BE |
| #48 | Mock API responses for frontend dev | 4h | Backend | BE |
| | **Sprint 1 subtotal** | **48h** | | |
| | Buffer for PR reviews, bugs, meetings | **12h** | | |

**Sprint 1 output:** All P0 bugs fixed, database schema in place, mock data available for frontend. Redesign branch merged to main.

---

## Sprint 2: Data Pipeline + Interactive Map (60 hrs)

Goal: Get real crash data flowing and the map actually showing data.

| # | Issue | Est | Assignee | Track |
|---|-------|-----|----------|-------|
| #39 | ETL pipeline: CCRS data from CKAN API | 12h | Backend | BE |
| #40 | FastAPI endpoints: /crashes, /stats, /demographics | 8h | Backend | BE |
| #73 | Backend: data validation + error handling | 4h | Backend | BE |
| #84 | GeoJSON: source + optimize county boundaries | 4h | Data | FE |
| #41 | County GeoJSON choropleth layer on map | 8h | Frontend | FE |
| #76 | Map: county click → select, highlight, show data | 6h | Frontend | FE |
| #42 | Replace static Stats charts with Recharts | 6h | Frontend | FE |
| #43 | Connect filters to API (Zustand store) | 6h | Frontend | FE |
| | **Sprint 2 subtotal** | **54h** | | |
| | Buffer | **6h** | | |

**Sprint 2 output:** Real crash data in the database, map shows choropleth, clicking counties works, Stats has real charts, filters are wired to API.

---

## Sprint 3: AI + Search + Mobile (60 hrs)

Goal: AI insight cards working, search functional, mobile layout.

| # | Issue | Est | Assignee | Track |
|---|-------|-----|----------|-------|
| #68 | Pre-computed insight cards at ETL time | 8h | Backend | BE |
| #71 | Backend: IP-based rate limiting | 3h | Backend | BE |
| #74 | Gemini API key rotation system | 6h | Backend | BE |
| #45 | AI Insight card: dynamic content | 4h | Frontend | FE |
| #44 | Search pill: search, location, zoom | 6h | Frontend | FE |
| #46 | Mobile responsive: bottom tabs + sheets | 12h | Frontend | FE |
| #47 | Settings/accessibility popover | 4h | Frontend | FE |
| #50 | Loading skeleton components | 3h | Frontend | FE |
| #51 | Error and empty states | 4h | Frontend | FE |
| | **Sprint 3 subtotal** | **50h** | | |
| | Buffer | **10h** | | |

**Sprint 3 output:** AI insight cards show real county data, search works on map, mobile layout functional, loading/error states in place.

---

## Sprint 4: Polish + Deploy (60 hrs)

Goal: Production-ready. Deploy. Documentation.

| # | Issue | Est | Assignee | Track |
|---|-------|-----|----------|-------|
| #56 | Gemini integration for Ask AI page | 8h | Backend | BE |
| #75 | Gemini response caching | 4h | Backend | BE |
| #72 | Backend pytest test suite | 6h | Backend | BE |
| #57 | Data export: CSV, PDF, PNG downloads | 6h | Frontend | FE |
| #53 | WCAG 2.2 AA accessibility audit | 6h | Frontend | FE |
| #49 | Vitest setup + component tests | 6h | Frontend | FE |
| #54 | Deploy to Railway or Fly.io | 6h | Infra | IN |
| #55 | CONTRIBUTING.md + documentation | 3h | Infra | IN |
| #82 | CI: verify GitHub Actions pipeline | 2h | Infra | IN |
| | **Sprint 4 subtotal** | **47h** | | |
| | Buffer | **13h** | | |

**Sprint 4 output:** Live deployment, AI Ask page working, tests in place, accessibility audited, docs written.

---

## Backlog (post-Sprint 4)

These are nice-to-haves after the core product ships:

| # | Issue | Est |
|---|-------|-----|
| #52 | Dark mode | 8h |
| #58 | SVG bear logo | 2h |
| #65 | Footer links wiring | 2h |
| #77 | URL state sync (shareable views) | 4h |
| #78 | Keyboard shortcuts | 4h |
| #79 | Print stylesheet | 3h |
| #80 | Page transitions | 2h |
| #81 | SEO meta tags | 3h |
| #85 | Performance: lazy loading | 4h |

---

## Team Split Suggestion

| Person | Focus | Why |
|--------|-------|-----|
| Person A | Backend + Data (ETL, API, DB, AI) | Needs Python/FastAPI depth |
| Person B | Frontend — Map + Interactions | Leaflet, filters, sidebar, choropleth |
| Person C | Frontend — Pages + Polish | Stats/About/AskAI content, mobile, design fixes |

Rotate PR reviews so everyone sees all the code.

---

## Timeline

| Sprint | Dates | Milestone |
|--------|-------|-----------|
| Sprint 1 | Mar 31 – Apr 13 | Bugs fixed, DB ready, redesign merged |
| Sprint 2 | Apr 14 – Apr 27 | Real data on map + charts |
| Sprint 3 | Apr 28 – May 11 | AI insights, search, mobile |
| Sprint 4 | May 12 – May 25 | Deployed, tested, documented |

**8 weeks to production-ready.** Backlog items continue after.
