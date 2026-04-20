"""Response model for /api/crashes."""

from datetime import datetime

from pydantic import BaseModel


class CrashOut(BaseModel):
    id: int
    collision_id: int
    data_source: str | None = None
    crash_datetime: datetime
    county_code: int
    county_name: str | None = None
    city_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    severity: str | None = None
    canonical_cause: str | None = None
    primary_factor: str | None = None
    number_killed: int | None = None
    number_injured: int | None = None
    weather: str | None = None
    road_condition: str | None = None
    lighting: str | None = None
    is_alcohol_involved: bool | None = None
    is_distraction_involved: bool | None = None
    pedestrian_involved: bool | None = None

    model_config = {"from_attributes": True}
