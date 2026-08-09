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


# Every admin-verify response — success OR failure — must be uncacheable so no
# intermediary or browser can replay a prior verdict (#291). Headers set on the
# injected `response` are dropped when the handler raises HTTPException (FastAPI
# builds a fresh error response), so the failure paths carry the header on the
# exception itself.
_NO_STORE = {"Cache-Control": "no-store"}


@router.post("/verify", response_model=VerifyResponse)
@_limiter.limit("5/minute")
def verify_admin_key(body: VerifyRequest, request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    admin_key = settings.effective_admin_key
    if not admin_key:
        raise HTTPException(
            status_code=503,
            detail="Admin key not configured on server",
            headers=_NO_STORE,
        )
    # Compare bytes, not str: hmac.compare_digest raises TypeError on strings
    # holding non-ASCII, which would surface as a 500 with a stack trace
    # instead of a clean 403 the moment someone set a key with an accent in it.
    if not hmac.compare_digest(body.key.encode("utf-8"), admin_key.encode("utf-8")):
        raise HTTPException(
            status_code=403, detail="Invalid admin key", headers=_NO_STORE
        )
    return VerifyResponse(status="ok")
