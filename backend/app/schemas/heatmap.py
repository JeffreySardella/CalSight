"""Response models for /api/crashes/heatmap."""

from pydantic import BaseModel


class HeatmapPoint(BaseModel):
    lat: float
    lng: float
    weight: int
    severity: str | None = None
    collision_id: int | None = None
    data_source: str | None = None
    crash_datetime: str | None = None
    canonical_cause: str | None = None
    weather: str | None = None
    lighting: str | None = None
    number_killed: int | None = None
    number_injured: int | None = None
    primary_road: str | None = None
    hit_run: str | None = None


class HeatmapResponse(BaseModel):
    points: list[HeatmapPoint]
    total_crashes: int
    batch: int | None = None
    total_batches: int | None = None
