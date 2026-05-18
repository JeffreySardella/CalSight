"""Response model for /api/weather."""

from pydantic import BaseModel


class WeatherOut(BaseModel):
    county_code: int
    year: int
    month: int
    avg_temp_f: float | None = None
    max_temp_f: float | None = None
    min_temp_f: float | None = None
    precipitation_in: float | None = None

    model_config = {"from_attributes": True}
