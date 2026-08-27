# CalSight Production Readiness Checklist

Deployment architecture: Cloudflare Pages (frontend) + LXC 100 Docker (backend via Cloudflare Tunnel) + VM 109 PostgreSQL (Proxmox)

Audit date: 2026-05-16

---

## 1. Environment Variables Needed for Prod

**Status: NEEDS_WORK**

| Variable | Required | File | Notes |
|----------|----------|------|-------|
| `DATABASE_URL` | Yes | `backend/.env` | Points to VM 109 Postgres via Tailscale |
| `DATABASE_URL_AZURE` | No | `backend/.env` | Legacy; can be removed now that Azure is decommissioned |
| `ETL_DATABASE_URL` | Yes (prod) | `backend/.env` | Write-capable role for ETL; API uses read-only role |
| `CORS_ORIGINS` | Yes | `backend/.env` | Must include `https://calsight.org` |
| `DEBUG` | Yes | `backend/.env` | Must be `false` in prod |
| `ETL_API_KEY` | Yes | `backend/.env` | Protects POST /api/etl/run |
| `LLM_PROVIDER` | Yes | `backend/.env` | Currently `together` |
| `LLM_API_KEY` | Yes | `backend/.env` | Required for /ask endpoint |
| `ALERT_WEBHOOK_URL` | Recommended | `backend/.env` | Discord/Slack webhook for ETL alerts |
| `CLOUDFLARED_TOKEN` | Yes | Root `.env` or shell | Used by `docker-compose.prod.yml` tunnel service |
| `BACKUP_DIR` | No | `backend/.env` | Defaults to `/opt/calsight/backups` |
| `CENSUS_API_KEY` | Optional | `backend/.env` | Used by ETL demographic loaders |
| `NOAA_API_TOKEN` | Optional | `backend/.env` | Used by ETL weather loader |

**Action items:**
- Verify prod `.env` on LXC 100 has `CORS_ORIGINS=https://calsight.org` (not localhost)
- Verify `DEBUG=false` in prod
- Ensure `ETL_API_KEY` is set to a strong random value
- Remove references to `DATABASE_URL_AZURE` / `ETL_DATABASE_URL_AZURE` since Azure is decommissioned (or just leave them empty)

---

## 2. CORS Configuration

**Status: NEEDS_WORK**

- **File:** `backend/app/settings.py` (line 55), `backend/app/main.py` (lines 29-33)
- **Default:** `cors_origins: str = "http://localhost:5173"` (dev only)
- The prod `.env` on LXC 100 must set `CORS_ORIGINS=https://calsight.org`
- `allow_methods=["*"]` and `allow_headers=["*"]` are overly permissive

**Action items:**
- Confirm the deployed `.env` includes `CORS_ORIGINS=https://calsight.org`
- Consider restricting `allow_methods` to `["GET", "POST", "OPTIONS"]` (no PUT/DELETE/PATCH needed)
- Consider restricting `allow_headers` to `["Content-Type", "X-ETL-API-Key", "Authorization"]`
- Note: Since the backend is exposed via Cloudflare Tunnel (not a direct public port), and the frontend on Cloudflare Pages calls `api.calsight.org`, CORS must allow the Pages origin

---

## 3. Rate Limiting Configuration

**Status: DONE (partially)**

- **File:** `backend/app/main.py` (lines 36-55) - global limiter + 429 handler
- **Applied to:**
  - `/api/ask` — `10/minute;200/day` (`backend/app/routers/ask.py:113`)
  - `/api/crashes` — `60/minute` (`backend/app/routers/crashes.py:52`)
  - `/api/heatmap` — `30/minute` (`backend/app/routers/heatmap.py:63`)
  - `/api/stats` — `30/minute` (`backend/app/routers/stats.py:898`)
- **Missing rate limits on:** `/api/etl/run` (protected by API key but no rate limit), all other read endpoints (demographics, context, insights, meta, reference, freshness, weather, crash_people, pipeline_health)

**Action items:**
- Add a blanket default rate limit (e.g., `120/minute`) as an app-level default on all undecorated endpoints
- Consider whether `get_remote_address` correctly resolves the client IP behind Cloudflare Tunnel (check `CF-Connecting-IP` or `X-Forwarded-For` header instead)
- The limiter uses in-memory storage by default; if the backend ever scales to multiple workers, switch to Redis-backed storage

---

## 4. Database Connection Pooling Settings

**Status: DONE**

- **File:** `backend/app/database.py`
- API pool: `pool_size=20`, `max_overflow=20`, `pool_recycle=3600`, `pool_pre_ping=True`
- ETL pool: `pool_size=5`, `max_overflow=5`, `pool_recycle=3600`, `pool_pre_ping=True`
- Read-only / write separation is implemented (`effective_database_url` vs `effective_etl_database_url`)

**Notes:**
- 20 + 20 overflow = 40 max connections for the API. With a single uvicorn worker (no `--workers` flag in Dockerfile CMD), this is appropriate for the current load
- `pool_pre_ping=True` guards against stale connections after Postgres restarts
- `pool_recycle=3600` prevents long-lived connections from hitting PostgreSQL's `idle_in_transaction_session_timeout`

**Action items:**
- If you add multiple uvicorn workers later, reduce `pool_size` per worker (e.g., `pool_size=5` with 4 workers = 20 total)
- Consider setting `pool_timeout=30` (SQLAlchemy default is 30s, but explicit is better)
- Monitor `pg_stat_activity` to verify connections don't pile up

---

## 5. Frontend Build Optimization

**Status: DONE**

- **File:** `frontend/vite.config.ts` (lines 86-103)
- Minifier: `terser` with `drop_console: true`, `drop_debugger: true`, `passes: 2`
- Sourcemaps: NOT explicitly configured, meaning Vite defaults to `false` for production builds (correct)
- Code splitting: Manual chunks for `vendor-react`, `vendor-leaflet`, `vendor-query`
- Large GeoJSON excluded from SW cache (`globIgnores: ['**/ca-counties.geojson']`)

**Action items:**
- Explicitly set `build.sourcemap: false` to be defense-in-depth (currently relying on the default)
- Consider adding `build.cssMinify: 'lightningcss'` for faster CSS minification (optional)
- The `ca-counties.topo.json` is included in SW precache — at ~200-400KB this is fine but monitor bundle size

---

## 6. Security Headers

**Status: NEEDS_WORK**

- **File:** `frontend/public/_headers` (Cloudflare Pages headers file)
- Present headers:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`
- **Missing:**
  - `Strict-Transport-Security` (HSTS) — Cloudflare provides this at the edge if "Always Use HTTPS" is enabled in the dashboard, but an explicit header is best practice
  - `Content-Security-Policy` (CSP) — not present anywhere

**Action items:**
- Add to `frontend/public/_headers` under `/*`:
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  ```
- Add a CSP header (example for CalSight's needs):
  ```
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://tile.openstreetmap.org https://og.calsight.org; connect-src 'self' https://api.calsight.org https://fonts.googleapis.com https://fonts.gstatic.com https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://tile.openstreetmap.org
  ```
  (Test carefully — the inline dark-mode script in `index.html` needs `'unsafe-inline'` or a nonce)
- Verify Cloudflare dashboard has "Always Use HTTPS" and "Minimum TLS Version: 1.2" enabled

---

## 7. Error Handling

**Status: DONE**

- **File:** `backend/app/main.py` (lines 66-72)
- Global `Exception` handler catches all unhandled errors:
  - Logs full traceback via `logger.exception()`
  - Returns generic `{"detail": "Internal server error"}` (no stack trace leak)
- Custom handlers for:
  - `FilterError` (422 with filter context)
  - `RateLimitExceeded` (429 with retry-after)
  - `AllProvidersExhausted` (503 with retry guidance)
- `debug=settings.debug` on the FastAPI app — when `DEBUG=false`, auto-docs and debug error pages are disabled

**Action items:**
- Verify `DEBUG=false` in prod `.env` (this disables `/docs` and `/redoc` auto-generated API docs)
- Consider structured JSON logging (e.g., `python-json-logger`) for easier log parsing in production
- Add request ID middleware for correlating logs across a request lifecycle

---

## 8. Health Check Endpoints

**Status: DONE**

- **File:** `backend/app/main.py` (lines 118-124)
- Endpoint: `GET /api/health` — executes `SELECT 1` against the database
- Returns `{"status": "ok"}` (200) or `{"status": "db_unavailable"}` (503)
- Docker healthcheck in `docker-compose.prod.yml` (line 23): `curl -sf http://127.0.0.1:8000/api/health` every 10s, 5s timeout, 3 retries
- Cloudflare Tunnel depends on `service_healthy` condition — won't route traffic until backend is healthy

**Action items:**
- Consider adding a `/api/health/deep` endpoint that also checks LLM provider connectivity and disk space
- Consider adding version/commit info to the health response for deployment verification

---

## 9. Monitoring Recommendations

**Status: MISSING**

Currently there is no APM, metrics collection, or alerting beyond Docker container health and ETL webhook alerts.

**Action items (priority order):**
1. **Uptime monitoring:** Use Cloudflare's free health checks or UptimeRobot to ping `https://api.calsight.org/api/health` every 5 min
2. **Container metrics:** Add `docker stats` collection via `prometheus/node-exporter` + cAdvisor on LXC 100
3. **Application metrics:** Add a `/metrics` endpoint with Prometheus client (request count, latency histograms, DB pool stats, cache hit rates)
4. **Log aggregation:** Ship Docker JSON logs to Loki or Cloudflare Logpush
5. **Alerting:** Expand `ALERT_WEBHOOK_URL` usage beyond ETL to cover 5xx spikes, health check failures, high response times
6. **PostgreSQL monitoring:** `pg_stat_statements` extension + periodic `pg_stat_activity` snapshots on VM 109

---

## 10. Backup Verification

**Status: DONE**

- **File:** `backend/etl/backup.py`
- Strategy: Daily `pg_dump --format=custom --compress=6` with 7-day retention
- Stored at `/opt/calsight/backups` (configurable via `BACKUP_DIR`)
- Includes restore documentation and rotation logic
- Timeout: 2 hours max for the 11M+ row dataset

**Action items:**
- Verify a cron job actually runs `python -m etl.backup` daily on LXC 100 (the script exists but scheduling is external)
- Test restore procedure: `pg_restore --clean --if-exists -d calsight <backup.dump>`
- Consider adding backup integrity verification (e.g., `pg_restore --list` after each dump to confirm it's not corrupt)
- Add backup size/success alerts to the Discord webhook
- Document WAL archiving setup for point-in-time recovery (mentioned in backup.py comments but not confirmed as configured)

---

## 11. SSL/TLS Configuration

**Status: DONE**

- Frontend: Cloudflare Pages provides automatic HTTPS with edge TLS termination
- Backend API: Cloudflare Tunnel (`cloudflared`) creates an encrypted tunnel from LXC 100 to Cloudflare's edge — no exposed ports, no self-managed certificates
- Database: Connections from LXC 100 to VM 109 traverse Tailscale (WireGuard-encrypted overlay network)

**Action items:**
- Verify Cloudflare SSL/TLS mode is set to "Full (Strict)" in the dashboard
- Ensure "Minimum TLS Version" is 1.2 in Cloudflare dashboard
- The `docker-compose.prod.yml` binds backend to `127.0.0.1:8000` (not 0.0.0.0) — correct, not externally reachable
- Consider enabling `sslmode=require` or `sslmode=verify-full` on the PostgreSQL connection string (currently relies on Tailscale encryption)

---

## 12. API Versioning Strategy

**Status: MISSING**

- All endpoints are under `/api/` with no version prefix (e.g., `/api/stats`, not `/api/v1/stats`)
- FastAPI app version is `0.1.0` but this is informational only

**Action items:**
- For a passion project with a small team, versionless `/api/` is acceptable for now
- If you ever need breaking changes, adopt URL-prefix versioning: `/api/v2/stats` alongside `/api/v1/stats`
- Document the current API contract (endpoint list + response shapes) so you know when a breaking change occurs
- Consider adding an `API-Version` response header for debugging

---

## 13. Cache Headers on Static Assets

**Status: DONE**

- **File:** `frontend/public/_headers`
- `/assets/*` — `Cache-Control: public, max-age=31536000, immutable` (Vite hashed filenames = safe to cache forever)
- `/index.html` — `Cache-Control: no-cache` (always revalidate for fresh SPA shell)
- `/sw.js` — `Cache-Control: no-cache` (service worker must always be fresh)
- `/ca-counties.topo.json` — `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`
- `/sitemap.xml`, `/robots.txt` — `Cache-Control: public, max-age=86400`

**Action items:**
- Add cache headers for `/site.webmanifest`: `Cache-Control: public, max-age=86400`
- Verify Cloudflare's "Cache Everything" page rule isn't overriding these for HTML pages
- The backend API responses have no explicit `Cache-Control` headers — the service worker handles caching client-side, but adding `Cache-Control: public, max-age=60` on stable reference endpoints (`/api/meta`, `/api/insights`) would help CDN edge caching if Cloudflare caches API responses

---

## 14. PWA Service Worker Configuration

**Status: DONE**

- **File:** `frontend/vite.config.ts` (lines 8-84) using `vite-plugin-pwa` with Workbox
- `registerType: 'autoUpdate'` — new SW activates immediately
- `skipWaiting: true`, `clientsClaim: true` — takes over all tabs on update
- Precache: `**/*.{js,css,html,svg,png,woff2,webp}` up to 4MB per file
- Runtime caching strategies:
  - Fonts: StaleWhileRevalidate / CacheFirst (appropriate)
  - Map tiles: CacheFirst with 30-day expiration, 500 entries
  - Mutable API data: StaleWhileRevalidate with 1-hour or 24-hour expiration
  - Live/ETL/Ask endpoints: NetworkOnly (correct — never cache these)
- `navigateFallback: '/index.html'` with denylist for `/api/` and `/admin/`

**Action items:**
- Add `start_url: "/"` and `scope: "/"` to `site.webmanifest` (currently missing; needed for proper PWA install prompt)
- Consider adding an offline fallback page for when NetworkOnly requests fail
- Monitor SW cache size on mobile devices — 500 map tiles at ~50KB each = ~25MB potential cache

---

## 15. Docker Image Optimization

**Status: NEEDS_WORK**

- **File:** `backend/Dockerfile`
- Uses `python:3.12-slim` (good, not full Debian)
- Non-root user (`app:app`) created and used (good)
- `pip install --no-cache-dir` (good, no pip cache in image)
- `apt-get` cleanup with `rm -rf /var/lib/apt/lists/*` (good)
- `.dockerignore`: `__pycache__`, `*.pyc`, `.venv`, `.env` (basic but adequate)

**Not present:**
- Multi-stage build (could reduce final image size by separating build deps from runtime)
- Pinned dependency versions in the Dockerfile (relies on requirements.txt which is fine)

**Action items:**
- Add to `backend/.dockerignore`:
  ```
  tests/
  .git/
  .github/
  docs/
  *.md
  .mypy_cache/
  .pytest_cache/
  .ruff_cache/
  etl/data/
  ```
- Consider a multi-stage build if image size becomes a concern (current slim image with deps is likely ~300-500MB)
- Add `HEALTHCHECK` instruction directly in the Dockerfile (currently only in compose)
- Pin the Python base image to a specific digest for reproducible builds:
  ```dockerfile
  FROM python:3.12-slim@sha256:<digest>
  ```
- Consider adding `--no-install-recommends` to `apt-get install` (already present, good)
- The `COPY . .` copies all source including `etl/` — if ETL doesn't run inside this container, exclude it

---

## Summary

| # | Item | Status |
|---|------|--------|
| 1 | Environment variables | NEEDS_WORK |
| 2 | CORS configuration | NEEDS_WORK |
| 3 | Rate limiting | DONE (partial) |
| 4 | DB connection pooling | DONE |
| 5 | Frontend build optimization | DONE |
| 6 | Security headers | NEEDS_WORK |
| 7 | Error handling | DONE |
| 8 | Health check endpoints | DONE |
| 9 | Monitoring | MISSING |
| 10 | Backup verification | DONE |
| 11 | SSL/TLS | DONE |
| 12 | API versioning | MISSING |
| 13 | Cache headers | DONE |
| 14 | PWA service worker | DONE |
| 15 | Docker image optimization | NEEDS_WORK |

**Critical items before launch:**
1. Verify `CORS_ORIGINS=https://calsight.org` in prod `.env`
2. Verify `DEBUG=false` in prod `.env`
3. Add HSTS header to `frontend/public/_headers`
4. Set up uptime monitoring on `/api/health`
5. Verify backup cron is running on LXC 100
6. Fix rate limiter IP resolution to use `CF-Connecting-IP` behind Cloudflare Tunnel

**Nice-to-have improvements:**
- CSP header (requires testing with inline scripts)
- Structured JSON logging
- Prometheus metrics endpoint
- Multi-stage Docker build
- Default rate limit on all endpoints
- `start_url` in webmanifest
