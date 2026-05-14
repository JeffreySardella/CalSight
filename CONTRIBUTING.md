# Contributing to CalSight

## Local Development Setup

### Prerequisites
- Node.js 20+
- Python 3.13+
- Docker (optional, for containerized backend)
- Access to the shared database via Tailscale

### Frontend
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

### Backend (direct)
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # fill in DATABASE_URL and API keys
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Backend (Docker)
```bash
# Uses Azure/Proxmox DB via backend/.env by default
docker compose up backend

# Or with a fresh local Postgres:
docker compose --profile local-db up
```

### Running Tests
```bash
# Frontend
cd frontend && npm test

# Backend (requires Tailscale connection to shared DB on VM 109)
cd backend && pytest

# Linting
cd frontend && npx eslint src/
cd backend && ruff check .
```

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<issue#>-short-desc` | `feat/119-fun-facts` |
| Bug fix | `fix/<issue#>-short-desc` | `fix/221-etl-pipeline` |
| Infra/CI | `infra/short-desc` | `infra/cloudflare-cache` |

## Pull Request Process

1. Create a branch from `main`
2. Make your changes with clear, atomic commits
3. Ensure CI passes (frontend lint + tests, backend lint + tests)
4. Open a PR with:
   - Summary of changes (what and why)
   - `Closes #<issue>` to auto-close the issue
   - Test plan checklist
5. Request review from at least one team member
6. Merge after approval — auto-deploys to production via GitHub Actions

## Architecture Overview

```
CalSight/
├── frontend/          # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/         # MapPage, StatsPage, AskAiPage, AboutPage
│   │   ├── components/    # Reusable UI components
│   │   ├── hooks/         # Data fetching and state hooks
│   │   ├── context/       # Theme, LiteMode, Accessibility providers
│   │   └── lib/           # Utilities, export functions, choropleth palettes
│   └── index.html
├── backend/           # FastAPI + SQLAlchemy + Alembic
│   ├── app/
│   │   ├── main.py        # FastAPI app, middleware
│   │   ├── models.py      # SQLAlchemy ORM models
│   │   ├── routers/       # API endpoints (stats, heatmap, crashes, etc.)
│   │   └── database.py    # DB connection and session management
│   ├── etl/               # ETL pipeline (data loading, transforms)
│   │   ├── orchestrator.py    # Job runner with dependency resolution
│   │   ├── jobs.py            # Job registry (all sources + config)
│   │   └── load_*.py          # Individual data loaders
│   └── migrations/        # Alembic database migrations
└── .github/workflows/ # CI (lint/test) and CD (deploy to Proxmox)
```

## Deployment

- **Frontend**: Cloudflare Pages (auto-deploys from `main`)
- **Backend**: Self-hosted on Proxmox LXC 100 via Docker Compose
- **Database**: PostgreSQL on Proxmox VM 109, connected via Tailscale
- Merging to `main` triggers auto-deploy via GitHub Actions

## Data Sources

| Source | Table(s) | Schedule | API |
|--------|----------|----------|-----|
| CHP CCRS (2016-present) | crashes, crash_parties, crash_victims | Daily | data.ca.gov CKAN |
| SWITRS (2001-2015) | crashes | Static (one-time) | Zenodo archive |
| Census ACS | demographics | Monthly | Census API |
| NOAA | county_weather | Monthly | NOAA API |
| Caltrans | traffic_volumes | Monthly | ArcGIS FeatureServer |
| DMV | vehicle_registrations | Monthly | data.ca.gov CKAN |
| CalEnviroScreen | calenviroscreen | Monthly | ArcGIS FeatureServer |
| BLS | bls_unemployment | Monthly | BLS API |
| CDE | schools | Monthly | data.ca.gov CKAN |
| OSHPD | hospitals | Monthly | data.ca.gov CKAN |

## Design System

- Material Design 3 tokens via CSS custom properties
- Tailwind CSS with custom theme extending MD3 palette
- Google Material Symbols (Outlined) for icons
- Font: Inter (body), custom headline font
- See `frontend/src/index.css` for the full token definitions
