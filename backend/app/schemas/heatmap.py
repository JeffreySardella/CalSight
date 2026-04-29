"""Response models for /api/crashes/heatmap."""

from pydantic import BaseModel


class HeatmapPoint(BaseModel):
    lat: float
    lng: float
    weight: int


class HeatmapResponse(BaseModel):
    points: list[HeatmapPoint]
    total_crashes: int
