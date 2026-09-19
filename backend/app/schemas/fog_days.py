"""Response models for /api/fog-days."""

from pydantic import BaseModel


class FogYear(BaseModel):
    # None on the whole-period `totals` roll-up, which spans every year.
    year: int | None
    fog_event_days: int
    crashes_on_fog_days: int
    fog_day_avg_crashes: float
    baseline_days: int
    # The raw off-fog crash count, so callers pooling several rows can sum it
    # instead of multiplying a 2dp average back out by the day count.
    crashes_off_fog_days: int
    baseline_avg_crashes: float
    lift_pct: float | None
    fog_coded_crashes: int


class FogCounty(BaseModel):
    county_code: int
    county_name: str
    county_slug: str
    years: list[FogYear]


class FogDaysOut(BaseModel):
    # Which slice this is: a county slug, or None for the statewide roll-up
    # across every county the zone map covers.
    county: str | None
    year: int | None
    fog_event_type: str
    # Comparison months, so the caller can say what "baseline" means.
    months: list[int]
    storm_events_through: int | None  # newest year with any fog event on record
    totals: FogYear | None
    years: list[FogYear]
    counties: list[FogCounty]
