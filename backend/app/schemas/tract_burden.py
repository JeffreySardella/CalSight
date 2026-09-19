"""Response models for /api/tract-burden."""

from pydantic import BaseModel


class TractBurdenRow(BaseModel):
    geoid: str
    county_code: int
    ces_percentile: float | None = None
    crash_count: int
    killed: int
    injured: int
    # Only present when CalEnviroScreen carried a population for the tract.
    crashes_per_1k_pop: float | None = None


class TractBurdenSummary(BaseModel):
    """Context the map legend is required to show alongside the colours."""

    # Share (0-1) of crashes in the selected years that have coordinates at
    # all — everything in `tracts` covers only that subset.
    coord_share: float | None = None
    tract_count: int
    start_year: int | None = None
    end_year: int | None = None
    # False when no tract had a CES population, so the rate is unavailable
    # and the caller must fall back to raw counts.
    population_available: bool


class TractBurdenOut(BaseModel):
    summary: TractBurdenSummary
    tracts: list[TractBurdenRow]
