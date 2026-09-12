"""Response models for /api/first-rain."""

from datetime import date

from pydantic import BaseModel


class StatewideWaterYear(BaseModel):
    water_year: int
    counties: int
    crashes_on_first_rain_days: int
    baseline_expected: float
    lift_pct: float | None
    median_first_rain_date: date


class Statewide(BaseModel):
    water_years: int
    median_lift_pct: float | None
    events: list[StatewideWaterYear]


class CountyEvent(BaseModel):
    county_code: int
    county_name: str
    county_slug: str
    water_year: int
    first_rain_date: date
    precip_in: float
    dry_days_before: int
    crashes_on_day: int
    baseline_daily_crashes: float
    lift_pct: float | None
    small_baseline: bool


class DaysSinceRain(BaseModel):
    county_code: int
    county_name: str
    county_slug: str
    last_rain_date: date | None
    days: int | None


class FirstRainOut(BaseModel):
    threshold_in: float
    min_dry_days: int
    baseline_days: int
    weather_through: date | None
    statewide: Statewide
    counties: list[CountyEvent]
    days_since_rain: list[DaysSinceRain]


class SeriesPoint(BaseModel):
    date: date
    crashes: int
    precip_in: float | None
    is_first_rain: bool


class FirstRainSeriesOut(BaseModel):
    county_code: int
    county_name: str
    water_year: int
    first_rain_date: date
    points: list[SeriesPoint]
