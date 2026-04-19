"""Response model for /api/meta/data-freshness."""

from datetime import datetime

from pydantic import BaseModel


class SourceFreshness(BaseModel):
    last_loaded_at: datetime | None
    rows_loaded: int | None
