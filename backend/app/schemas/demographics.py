"""Response model for /api/demographics."""

from pydantic import BaseModel


class DemographicOut(BaseModel):
    county_code: int
    year: int
    population: int | None = None
    median_age: float | None = None
    median_income: int | None = None
    population_density: float | None = None

    # Race
    pct_white: float | None = None
    pct_black: float | None = None
    pct_asian: float | None = None
    pct_hispanic: float | None = None
    pct_other_race: float | None = None

    # Age brackets
    pct_under_18: float | None = None
    pct_18_24: float | None = None
    pct_25_44: float | None = None
    pct_45_64: float | None = None
    pct_65_plus: float | None = None

    # Sex
    pct_male: float | None = None
    pct_female: float | None = None

    # Economic
    per_capita_income: int | None = None

    # Exposure + equity
    mean_travel_time_to_work: float | None = None  # minutes
    pct_foreign_born: float | None = None

    # Stress / household
    pct_rent_burdened: float | None = None  # paying 30%+ of income in rent
    pct_enrolled_in_school: float | None = None

    # Niche risk correlates
    pct_veteran: float | None = None
    pct_with_disability: float | None = None

    # Socioeconomic
    poverty_rate: float | None = None
    pct_bachelors_or_higher: float | None = None
    pct_high_school_or_higher: float | None = None

    # Housing / transportation
    pct_no_vehicle: float | None = None
    pct_owner_occupied_housing: float | None = None

    # Commute
    commute_drive_alone_pct: float | None = None
    commute_carpool_pct: float | None = None
    commute_transit_pct: float | None = None
    commute_walk_pct: float | None = None
    commute_bike_pct: float | None = None
    commute_wfh_pct: float | None = None

    # Language
    pct_english_only: float | None = None
    pct_spanish_speaking: float | None = None

    model_config = {"from_attributes": True}
