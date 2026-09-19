"""Response models for /api/holidays."""

from pydantic import BaseModel


class DayRates(BaseModel):
    """Counts and per-day rates over a set of calendar days."""

    days: int
    crashes: int
    killed: int
    dui_crashes: int
    crashes_per_day: float
    deaths_per_day: float
    dui_share_pct: float


class HolidayOut(DayRates):
    key: str
    label: str
    baseline_month: str
    baseline: DayRates
    #: Too few baseline crashes/day or too few pooled holiday days for the
    #: lift to be trusted. The figures are still reported — the frontend marks
    #: them rather than hiding them.
    small_sample: bool
    crashes_lift_pct: float | None
    deaths_lift_pct: float | None
    dui_share_lift_pct: float | None


class HolidaysOut(BaseModel):
    first_year: int
    last_year: int
    county_code: int | None
    county_name: str | None
    holidays: list[HolidayOut]
