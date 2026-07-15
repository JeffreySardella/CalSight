"""Response models for /api/water endpoints."""

from datetime import date

from pydantic import BaseModel


class ReservoirConditionOut(BaseModel):
    """One reservoir with its latest storage reading and derived context."""

    station_id: str
    name: str
    capacity_af: int
    county_code: int | None = None
    latest_date: date
    storage_af: float
    pct_of_capacity: float           # storage / capacity * 100
    # Average storage on this day-of-year across all loaded years, and
    # today's storage relative to it. None until enough history is loaded.
    avg_storage_af: float | None = None
    pct_of_average: float | None = None


class ReservoirSeriesPoint(BaseModel):
    date: date
    storage_af: float


class ReservoirSeriesOut(BaseModel):
    """Daily storage time series for one reservoir."""

    station_id: str
    name: str
    capacity_af: int
    points: list[ReservoirSeriesPoint]
