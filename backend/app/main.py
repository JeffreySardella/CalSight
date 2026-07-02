import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from app.database import engine, get_db
from app.filters import FilterError
from app.health import is_rebuilding
from app.settings import settings

logger = logging.getLogger(__name__)


# -- Sentry error monitoring (no-op unless SENTRY_DSN is set) --
# Must init before `app = FastAPI()` so the Starlette/FastAPI integrations
# auto-attach. We keep send_default_pii=False: CalSight is a public,
# privacy-conscious app, so IPs/headers/cookies/query strings stay out of
# error reports.
if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
    logger.info(
        "Sentry error monitoring enabled (environment=%s)",
        settings.sentry_environment,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("CalSight API starting up")
    yield
    logger.info("CalSight API shutting down — disposing DB pool")
    engine.dispose()


app = FastAPI(
    title="CalSight API",
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

class MaintenanceModeMiddleware(BaseHTTPMiddleware):
    """Return 503 + Retry-After for API requests while maintenance mode is on.

    Lets the app be taken offline gracefully for a server/DB migration instead
    of users hitting raw errors. /api/health is exempt so uptime monitors and
    the static frontend can still detect status and show a maintenance screen.
    """

    EXEMPT_PATHS = ("/api/health",)

    async def dispatch(self, request: Request, call_next):
        if settings.maintenance_mode and request.url.path not in self.EXEMPT_PATHS:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "maintenance",
                    "message": "CalSight is temporarily down for scheduled "
                    "maintenance. Please check back shortly.",
                },
                headers={"Retry-After": "120"},
            )
        return await call_next(request)


app.add_middleware(GZipMiddleware, minimum_size=1000)
# Added before CORS so CORS remains the outer layer — the 503 must carry
# Access-Control-Allow-Origin or the browser can't read it to show the screen.
app.add_middleware(MaintenanceModeMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-ETL-API-KEY"],
    expose_headers=["X-Cache"],
)

class NullByteSanitizationMiddleware(BaseHTTPMiddleware):
    """Reject requests containing null bytes in the URL or query string.

    Null bytes (%00) in query parameters cause unhandled exceptions in
    downstream parsing (e.g. int(), str.split()). ZAP DAST flagged 7
    endpoints returning 500 for this. We return 400 early instead.
    """

    async def dispatch(self, request: Request, call_next):
        raw_url = str(request.url)
        if "\x00" in raw_url or "%00" in raw_url.upper():
            return JSONResponse(
                status_code=400,
                content={"detail": "Request contains invalid null byte characters."},
            )
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: StarletteResponse = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(NullByteSanitizationMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

from slowapi import Limiter  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from slowapi.util import get_remote_address  # noqa: E402

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    retry_after = int(getattr(exc, "retry_after", 60) or 60)
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "message": f"Too many requests. Try again in {retry_after} seconds.",
            "retry_after": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )


@app.exception_handler(FilterError)
async def filter_error_handler(request: Request, exc: FilterError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.detail, "filter": exc.filter},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


from app.llm import AllProvidersExhausted  # noqa: E402


@app.exception_handler(AllProvidersExhausted)
async def all_providers_exhausted_handler(request: Request, exc: AllProvidersExhausted):
    return JSONResponse(
        status_code=503,
        content={"error": "ai_busy", "message": "All AI providers are temporarily busy. Please try again in a few minutes.", "retry_after": 60},
        headers={"Retry-After": "60"},
    )


from app.routers.context import router as context_router  # noqa: E402
from app.routers.crash_people import router as crash_people_router  # noqa: E402
from app.routers.crashes import router as crashes_router  # noqa: E402
from app.routers.demographics import router as demographics_router  # noqa: E402
from app.routers.freshness import router as freshness_router  # noqa: E402
from app.routers.heatmap import router as heatmap_router  # noqa: E402
from app.routers.pipeline_health import router as pipeline_health_router  # noqa: E402
from app.routers.ask import router as ask_router  # noqa: E402
from app.routers.insights import router as insights_router  # noqa: E402
from app.routers.intersections import router as intersections_router  # noqa: E402
from app.routers.meta import router as meta_router  # noqa: E402
from app.routers.reference import router as reference_router  # noqa: E402
from app.routers.admin import router as admin_router  # noqa: E402
from app.routers.etl import router as etl_router  # noqa: E402
from app.routers.stats import router as stats_router  # noqa: E402
from app.routers.weather import router as weather_router  # noqa: E402
from app.routers.fars import router as fars_router  # noqa: E402
from app.routers.tract_density import router as tract_density_router  # noqa: E402

app.include_router(reference_router, prefix="/api")
app.include_router(demographics_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(crashes_router, prefix="/api")
app.include_router(crash_people_router, prefix="/api")
app.include_router(freshness_router, prefix="/api")
app.include_router(heatmap_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(meta_router, prefix="/api")
app.include_router(insights_router, prefix="/api")
app.include_router(intersections_router, prefix="/api")
app.include_router(ask_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(etl_router, prefix="/api")
app.include_router(pipeline_health_router, prefix="/api")
app.include_router(weather_router, prefix="/api")
app.include_router(fars_router, prefix="/api")
app.include_router(tract_density_router, prefix="/api")


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    if settings.maintenance_mode:
        return JSONResponse(status_code=503, content={"status": "maintenance"})
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "db_unavailable"})
    if is_rebuilding(db):
        return {"status": "rebuilding"}
    return {"status": "ok"}
