# CalSight

Ever wonder which California intersections are the most dangerous, or whether DUI crashes are actually going down? We did too.

CalSight pulls 11.6 million crash records from California's public data and lets you explore them on a map, dig into the stats, or just ask a question in plain English. It's a civic tech project built by a small team who wanted to make this data accessible to everyone — not just researchers with SQL skills.

**Check it out at [calsight.org](https://calsight.org)**

## What you can do

**Explore the map** — see crash density by county, zoom into street-level crash dots, or turn on the heatmap. Filter by year, severity, cause, weather, lighting, time of day, and more.

**Dig into stats** — chart breakdowns across the state or any county. Crashes by hour, cause, age, gender, at-fault driver demographics, per-capita rates — all filterable.

**Ask AI** — type a question like "Which county has the highest DUI fatality rate?" and get an answer with inline charts pulled from the actual data.

**Check water conditions** — daily storage at the state's major reservoirs against capacity and historical averages, Sierra snowpack by region, plus weekly county-level drought severity from the US Drought Monitor. (No AI anywhere in this module — pure data engineering.)

**AI insights** — every county gets pre-computed narratives highlighting what makes it unique. Click any county on the map to see its story.

Also: dark mode, offline support (PWA), keyboard accessibility, high contrast mode, and it works on your phone.

## Tech stack

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind, Leaflet, custom SVG charts |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0 |
| Database | PostgreSQL 17 — 11.6M crashes, ~9M parties, 10 materialized views |
| AI | Multi-provider fallback: Groq (gpt-oss-120b) → Gemini → OpenRouter |
| ETL | 30 jobs pulling from 12 providers — CKAN, Census, NOAA, NHTSA, BLS, CalEnviroScreen, CDEC, USDM |
| Infra | Cloudflare Pages + self-hosted backend on Proxmox LXC |

## Run it locally

```bash
git clone https://github.com/JeffreySardella/CalSight.git
cd CalSight
docker compose up --build
```

Frontend at http://localhost:5180, API at http://localhost:8000, docs at http://localhost:8000/docs.

By default the backend connects to our shared database. For a fresh local Postgres:

```bash
docker compose --profile local-db up --build
```

Or without Docker:

```bash
# Backend
cd backend
pip install -r requirements-dev.txt
cp .env.example .env  # set DATABASE_URL
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Tests

```bash
cd backend && pytest -m "not integration"  # unit tests; drop the -m to include integration tests (needs a DB)
cd frontend && npm test
```

## Project layout

```
backend/
  app/          FastAPI app — routers, models, filters, LLM client
  etl/          Data pipeline — 30 jobs across 12 data providers
  migrations/   Alembic schema migrations
  tests/        Backend test suite

frontend/
  src/
    components/   Map layers, charts, filters, UI
    pages/        Map, Stats, Ask AI, Water, About, Privacy, Terms, 404
    hooks/        Data fetching, filter state, map controls
    context/      Theme, accessibility, lite mode
```

## Data sources

- [CCRS](https://data.ca.gov/dataset/ccrs) — California crash records, 2016–present (CHP via data.ca.gov)
- [SWITRS](https://zenodo.org/records/4284843) — Historical crash records, 2001–2015 (CHP archive on Zenodo)
- [NHTSA FARS](https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars) — Fatal-crash aggregates per county-year
- [ACS](https://www.census.gov/programs-surveys/acs) — Demographics and lived density (Census Bureau)
- [CalEnviroScreen 5.0](https://oehha.ca.gov/calenviroscreen) — Environmental justice scores
- [NOAA nClimGrid (monthly + daily)](https://www.ncei.noaa.gov/products/land-based-station/nclimgrid-daily) — County weather
- [HPMS](https://www.fhwa.dot.gov/policyinformation/hpms.cfm) — Road miles and traffic volumes
- [DMV](https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code) — Vehicle registrations and licensed drivers
- [CDE](https://www.cde.ca.gov/ds/si/ds/pubschls.asp) — School locations
- [HCAI](https://data.chhs.ca.gov/) — Hospitals and trauma centers
- [OpenStreetMap](https://www.openstreetmap.org/copyright) — Bridge segments for coordinate validation
- [CDEC](https://cdec.water.ca.gov) — Reservoir storage, snowpack and precipitation indices (CA Dept. of Water Resources)
- [US Drought Monitor](https://droughtmonitor.unl.edu) — Weekly drought severity (NDMC/USDA/NOAA)

## Contributing

Grab an [open issue](../../issues), branch off `main`, write tests, open a PR. CI (unit, Playwright e2e, Lighthouse accessibility gate, CodeQL) runs on every push. One approval to merge.

## License

MIT
