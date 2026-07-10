"""Admin verification endpoint."""

from __future__ import annotations

import hmac

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from slowapi import Limiter
from app.rate_limit import rate_limit_key
from starlette.requests import Request

from app.settings import settings

router = APIRouter(prefix="/admin", tags=["admin"])

_limiter = Limiter(key_func=rate_limit_key)


class VerifyRequest(BaseModel):
    key: str


@router.post("/verify")
@_limiter.limit("5/minute")
def verify_admin_key(body: VerifyRequest, request: Request):
    admin_key = settings.effective_admin_key
    if not admin_key:
        raise HTTPException(status_code=503, detail="Admin key not configured on server")
    if not hmac.compare_digest(body.key, admin_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
    return {"status": "ok"}
