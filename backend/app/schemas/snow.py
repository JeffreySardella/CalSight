"""Response models for /api/water/snowpack."""

from datetime import date

from pydantic import BaseModel


class RegionSnowpack(BaseModel):
    """Current snow water equivalent for one DWR region.

    All figures come from ONE station set (per-station means, not sums):
    when history exists, the set is the stations with a usable day-of-year
    baseline, so swe_in always equals pct_of_average% of avg_swe_in;
    otherwise every recent station is included and the average fields are
    None. station_count is the size of that set.
    """

    region: str
    station_count: int
    latest_date: date
    swe_in: float                    # mean current SWE across the counted stations
    avg_swe_in: float | None = None  # mean same-day-of-year average (None until history)
    pct_of_average: float | None = None


class SnowpackOut(BaseModel):
    """Latest statewide snowpack plus a per-region breakdown."""

    latest_date: date
    statewide_pct_of_average: float | None = None
    regions: list[RegionSnowpack]
