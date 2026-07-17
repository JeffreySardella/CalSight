"""Response models for /api/water/precip."""

from datetime import date

from pydantic import BaseModel


class PrecipIndexOut(BaseModel):
    """One DWR regional precipitation index's latest accumulated total.

    accum_in is the water-year-to-date precipitation; pct_of_average compares
    it to the same-day-of-year historical average (None until >1 year of
    history exists), exactly like the reservoir and snowpack conventions.
    """

    station_id: str          # CDEC index id, e.g. "8SI"
    name: str
    region: str
    latest_date: date
    accum_in: float
    avg_accum_in: float | None = None  # same-day-of-year average (None until history)
    pct_of_average: float | None = None
