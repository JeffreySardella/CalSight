"""Admin verification endpoint.

Provides a simple key-check so the frontend admin gate can validate
credentials without exposing the key in client-side code.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, HTTPException, Query

from app.settings import settings

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/verify")
def verify_admin_key(key: str = Query(..., description="Admin key to verify")):
    """Verify the provided key matches ETL_API_KEY.

    Returns 200 on success, 403 on mismatch, 503 if no key is configured.
    """
    if not settings.etl_api_key:
        raise HTTPException(status_code=503, detail="Admin key not configured on server")
    if not hmac.compare_digest(key, settings.etl_api_key):
        raise HTTPException(status_code=403, detail="Invalid admin key")
    return {"status": "ok"}
