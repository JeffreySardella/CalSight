"""Response models for /api/water/snowpack."""

from datetime import date

from pydantic import BaseModel


class RegionSnowpack(BaseModel):
    """Current snow water equivalent for one DWR region, summed across its
    stations, with percent of the same-day-of-year historical average."""

    region: str
    station_count: int
    latest_date: date
    swe_in: float                    # summed current SWE across the region's stations
    avg_swe_in: float | None = None  # summed same-day-of-year average (None until history)
    pct_of_average: float | None = None


class SnowpackOut(BaseModel):
    """Latest statewide snowpack plus a per-region breakdown."""

    latest_date: date
    statewide_pct_of_average: float | None = None
    regions: list[RegionSnowpack]
