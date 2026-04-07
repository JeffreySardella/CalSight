# CalSight Backend

FastAPI backend serving crash data, demographics, and pre-computed insights.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

## Database

Requires PostgreSQL 16. Start with Docker:

```bash
docker-compose up db
```

### Run Migrations

```bash
alembic upgrade head
```

### Seed Counties

Populates the `counties` table with all 58 California counties:

```bash
python -m app.seed_counties
```

### Create a New Migration

After modifying models in `app/models.py`:

```bash
alembic revision --autogenerate -m "description of change"
```

## Schema

| Table | Description | Key Indexes |
|-------|-------------|-------------|
| `counties` | 58 CA counties (PK: code) | unique on name |
| `crashes` | CCRS crash records (FK: county_code) | county_code, crash_datetime, primary_factor, county+datetime composite |
| `demographics` | Yearly Census ACS data (FK: county_code) | unique on county_code+year |
| `county_insights` | Pre-computed stats per county/year | unique on county_code+year |
| `county_insight_details` | Breakdowns by category | unique on county_code+year+category+label |
| `etl_runs` | Pipeline execution log | source+started_at composite |

## Run the Server

```bash
uvicorn app.main:app --reload
```

API docs at http://localhost:8000/docs

## Tests

```bash
pytest tests/ -v
```
