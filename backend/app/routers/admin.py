"""Admin verification endpoint."""

from __future__ import annotations

import hmac

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from starlette.requests import Request

from app.settings import settings

router = APIRouter(prefix="/admin", tags=["admin"])

_limiter = Limiter(key_func=rate_limit_key)


class VerifyRequest(BaseModel):
    key: str


class VerifyResponse(BaseModel):
    status: str


@router.post("/verify", response_model=VerifyResponse)
@_limiter.limit("5/minute")
def verify_admin_key(body: VerifyRequest, request: Request, response: Response):
    # Explicitly uncacheable: this is an auth check — no intermediary or
    # browser cache may replay a prior verdict (#291).
    response.headers["Cache-Control"] = "no-store"
    admin_key = settings.effective_admin_key
    if not admin_key:
        raise HTTPException(status_code=503, detail="Admin key not configured on server")
    if not hmac.compare_digest(body.key, admin_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
    return VerifyResponse(status="ok")
