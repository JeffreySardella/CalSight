"""Response models for /api/stats — shape varies by group_by."""

from pydantic import BaseModel


class GrandTotal(BaseModel):
    total_crashes: int
    total_killed: int
    total_injured: int


class CountyRow(BaseModel):
    county_code: int
    county_name: str | None = None
    crash_count: int
    total_killed: int
    total_injured: int


class YearRow(BaseModel):
    year: int
    crash_count: int
    total_killed: int
    total_injured: int


class CauseRow(BaseModel):
    canonical_cause: str
    crash_count: int
    total_killed: int
    total_injured: int


class HourRow(BaseModel):
    hour: int
    crash_count: int


class SeverityRow(BaseModel):
    severity: str
    crash_count: int
    total_killed: int
    total_injured: int


class GenderRow(BaseModel):
    """Row from /api/stats?group_by=gender. Counts VICTIMS, not crashes —
    sourced from mv_crash_victims_by_demographics, so a single fatal crash
    with 1 driver and 2 injured passengers contributes 3 to victim_count."""
    gender: str
    victim_count: int
    fatal_victim_count: int


class AgeBracketRow(BaseModel):
    """Row from /api/stats?group_by=age_bracket. Same victim-count caveat
    as GenderRow. Buckets: under_18, 18_24, 25_44, 45_64, over_65, unknown
    (matches the demographics table conventions)."""
    age_bracket: str
    victim_count: int
    fatal_victim_count: int
