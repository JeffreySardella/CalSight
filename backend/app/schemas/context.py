"""Response models for context endpoints: unemployment, vehicles, drivers,
data-quality, insights."""

from pydantic import BaseModel


class UnemploymentOut(BaseModel):
    county_code: int
    year: int
    month: int
    unemployment_rate: float | None = None

    model_config = {"from_attributes": True}


class VehicleRegistrationOut(BaseModel):
    county_code: int
    year: int
    total_vehicles: int | None = None
    ev_vehicles: int | None = None

    model_config = {"from_attributes": True}


class LicensedDriverOut(BaseModel):
    county_code: int
    year: int
    driver_count: int | None = None

    model_config = {"from_attributes": True}


class DataQualityStatOut(BaseModel):
    county_code: int | None = None
    year: int | None = None
    total_crashes: int | None = None
    crashes_with_coords: int | None = None
    coords_pct: float | None = None
    crashes_with_primary_factor: int | None = None
    primary_factor_pct: float | None = None
    crashes_with_weather: int | None = None
    weather_pct: float | None = None
    crashes_with_road_cond: int | None = None
    road_cond_pct: float | None = None
    crashes_with_lighting: int | None = None
    lighting_pct: float | None = None
    crashes_with_alcohol_flag: int | None = None
    alcohol_flag_pct: float | None = None
    crashes_alcohol_true: int | None = None
    alcohol_true_pct: float | None = None
    crashes_with_distraction_flag: int | None = None
    distraction_flag_pct: float | None = None
    crashes_distraction_true: int | None = None
    distraction_true_pct: float | None = None
    total_parties: int | None = None
    parties_with_age: int | None = None
    age_pct: float | None = None
    parties_with_gender: int | None = None
    gender_pct: float | None = None
    parties_with_sobriety: int | None = None
    sobriety_pct: float | None = None
    total_victims: int | None = None
    victims_with_injury_severity: int | None = None
    injury_severity_pct: float | None = None

    model_config = {"from_attributes": True}


class CountyInsightOut(BaseModel):
    county_code: int
    year: int
    total_crashes: int | None = None
    total_killed: int | None = None
    total_injured: int | None = None
    crash_rate_per_capita: float | None = None
    top_cause: str | None = None
    top_cause_pct: float | None = None
    yoy_change_pct: float | None = None
    peak_hour: int | None = None
    dui_pct: float | None = None
    narrative: str | None = None

    model_config = {"from_attributes": True}
