"""Response models for /api/water/drought endpoints."""

from datetime import date

from pydantic import BaseModel


class DroughtPcts(BaseModel):
    """Percent of land area per USDM severity class (categorical stats:
    classes are exclusive and sum to ~100 with none_pct)."""

    none_pct: float
    d0_pct: float
    d1_pct: float
    d2_pct: float
    d3_pct: float
    d4_pct: float


class DroughtCountyOut(DroughtPcts):
    county_code: int


class DroughtSnapshotOut(BaseModel):
    """Latest USDM week: statewide land-area-weighted percents plus
    every county's breakdown."""

    week_start: date
    statewide: DroughtPcts
    counties: list[DroughtCountyOut]


class DroughtWeekPoint(DroughtPcts):
    week_start: date
