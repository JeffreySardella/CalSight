"""Response models for the /api/meta/* endpoints."""

from datetime import datetime

from pydantic import BaseModel


class SourceFreshness(BaseModel):
    last_loaded_at: datetime | None
    rows_loaded: int | None


class CoordValidationOut(BaseModel):
    """Summary counts for /api/meta/coord-validation."""

    total_with_coords: int
    mismatched: int
    valid: int
    unchecked: int


class CoordMismatchItem(BaseModel):
    id: int
    collision_id: int
    latitude: float | None
    longitude: float | None
    county_code: int
    county_name: str | None
    crash_datetime: str | None  # ISO 8601
    data_source: str | None
    coord_validated_at: str | None  # ISO 8601


class CoordMismatchesOut(BaseModel):
    """Paginated envelope for /api/meta/coord-mismatches."""

    total: int
    offset: int
    limit: int
    items: list[CoordMismatchItem]
