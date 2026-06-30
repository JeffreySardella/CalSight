"""Response model for /api/tract-density."""

from pydantic import BaseModel


class TractDensityOut(BaseModel):
    county_code: int
    year: int
    weighted_density: float | None = None
    tract_count: int | None = None

    model_config = {"from_attributes": True}
