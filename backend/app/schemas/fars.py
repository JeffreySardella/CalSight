"""Response model for /api/fars."""

from pydantic import BaseModel


class FarsOut(BaseModel):
    county_code: int
    year: int
    fatalities: int | None = None
    unrestrained_killed: int | None = None
    restraint_known_killed: int | None = None

    model_config = {"from_attributes": True}
