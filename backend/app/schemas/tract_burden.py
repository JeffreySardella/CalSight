"""Response models for /api/tract-burden."""

from pydantic import BaseModel


class TractBurdenRow(BaseModel):
    geoid: str
    county_code: int
    ces_percentile: float | None = None
    crash_count: int
    killed: int
    injured: int
    # Null when CalEnviroScreen carried no population for this tract. Callers
    # must not read that as zero: the tract's burden is only expressible as a
    # raw count, and has to be labelled as such where it is shown.
    crashes_per_1k_pop: float | None = None


class TractBurdenSummary(BaseModel):
    """Context the map legend is required to show alongside the colours."""

    # Share (0-1) of crashes in the selected years that have coordinates at
    # all — everything in `tracts` covers only that subset.
    coord_share: float | None = None
    tract_count: int
    start_year: int | None = None
    end_year: int | None = None
    # False when NO tract had a CES population, so the whole ramp falls back
    # to raw counts. True does not mean every tract has one — see
    # tracts_without_population and each row's crashes_per_1k_pop.
    population_available: bool
    # How many returned tracts have no population, and so can only show a
    # count while the ramp is a rate.
    tracts_without_population: int = 0


class TractBurdenOut(BaseModel):
    summary: TractBurdenSummary
    tracts: list[TractBurdenRow]
