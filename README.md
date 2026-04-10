# CalSight

California Crash Data Explorer — an open source civic tech tool that makes California's public crash data explorable through interactive maps, charts, and filters.

## What It Does

Takes millions of crash records from California's [Crash Reporting System (CCRS)](https://data.ca.gov/dataset/ccrs) and presents them through:

- Choropleth map showing crash density by county
- Charts breaking down crashes by year, cause, time of day, severity
- Filters to drill into specific data slices
- AI-powered natural language queries (coming soon)

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React, TypeScript, Vite |
| Maps | Leaflet |
| Charts | Recharts |
| Backend | Python, FastAPI |
| Database | PostgreSQL |
| Containers | Docker + docker-compose |
| CI/CD | GitHub Actions |

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Git](https://git-scm.com/)

### Run Locally

```bash
git clone https://github.com/JeffreySardella/CalSight.git
cd CalSight
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

```bash
# Stop all services
docker-compose down

# Stop and reset database
docker-compose down -v

# Rebuild after dependency changes
docker-compose up --build
```

### Run Without Docker

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Requires a running PostgreSQL instance — update `DATABASE_URL` in `.env`.

## Database

PostgreSQL 16 with schema managed by Alembic migrations.

### Tables

| Table | Purpose |
|-------|---------|
| `counties` | 58 California counties — FIPS codes, coordinates, boundaries |
| `crashes` | Individual crash records from CCRS (indexed by county, date, cause) |
| `demographics` | Yearly Census ACS data per county (population, income, commute modes) |
| `county_insights` | Pre-computed summary stats and AI narrative per county/year |
| `county_insight_details` | Granular breakdowns by category (collision type, cause, etc.) |
| `etl_runs` | ETL pipeline execution history |

### Migrations

```bash
# Run migrations (done automatically on docker-compose up)
cd backend
alembic upgrade head

# Seed counties table
python -m app.seed_counties

# Create a new migration after changing models
alembic revision --autogenerate -m "description of change"
```

## Project Structure

```
CalSight/
├── backend/
│   ├── app/          # FastAPI application
│   ├── migrations/   # Alembic database migrations
│   ├── etl/          # Data pipeline (CKAN API → PostgreSQL)
│   ├── tests/        # Backend tests
│   ├── alembic.ini
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/  # Map, charts, filters
│   │   ├── pages/
│   │   └── hooks/
│   ├── Dockerfile
│   └── package.json
├── docs/             # Design spec and pitch
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Contributing

1. Pick a task from [GitHub Projects](../../projects)
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Open a PR — needs 1 approval to merge

## Data Source

[California Crash Reporting System (CCRS)](https://data.ca.gov/dataset/ccrs) — public data published by the State of California on data.ca.gov.

## License

MIT
