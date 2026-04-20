import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.filters import FilterError
from app.settings import settings

logger = logging.getLogger(__name__)

app = FastAPI(title="CalSight API", version="0.1.0", debug=settings.debug)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
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


from app.routers.context import router as context_router  # noqa: E402
from app.routers.crash_people import router as crash_people_router  # noqa: E402
from app.routers.crashes import router as crashes_router  # noqa: E402
from app.routers.demographics import router as demographics_router  # noqa: E402
from app.routers.meta import router as meta_router  # noqa: E402
from app.routers.reference import router as reference_router  # noqa: E402
from app.routers.stats import router as stats_router  # noqa: E402

app.include_router(reference_router, prefix="/api")
app.include_router(demographics_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(crashes_router, prefix="/api")
app.include_router(crash_people_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(meta_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
