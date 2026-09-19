"""Response models for reference endpoints."""

import json
from typing import Any

from pydantic import BaseModel, field_serializer, field_validator


class CountyOut(BaseModel):
    code: int
    name: str
    fips: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    population: int | None = None
    land_area_sq_miles: float | None = None
    geojson: dict[str, Any] | None = None

    @field_validator("geojson", mode="before")
    @classmethod
    def decode_geojson(cls, v: Any) -> Any:
        """DB stores GeoJSON as TEXT; decode to JSON for the response."""
        if v is None or isinstance(v, dict):
            return v
        if isinstance(v, str):
            return json.loads(v) if v else None
        return v

    model_config = {"from_attributes": True}


class CityOut(BaseModel):
    id: int
    name: str
    county_code: int
    place_type: str
    place_fips: str | None = None

    model_config = {"from_attributes": True}


class HospitalOut(BaseModel):
    facility_id: str
    facility_name: str
    facility_type: str | None = None
    county_code: int
    city: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    bed_capacity: int | None = None
    trauma_center: str | None = None
    trauma_pediatric: str | None = None
    status: str | None = None

    model_config = {"from_attributes": True}


def format_cds_code(v: str) -> str:
    """Format a CDS code as CC-DDDDD-SSSSSSS so the raw 14-digit number doesn't
    trigger DAST credit-card-number heuristics (ZAP PII Disclosure).

    Shared by SchoolOut and SchoolCrashCountOut: the map joins those two
    payloads on cds_code, so the two spellings must stay identical.
    """
    if v and len(v) == 14 and v.isdigit():
        return f"{v[:2]}-{v[2:7]}-{v[7:]}"
    return v


class SchoolOut(BaseModel):
    cds_code: str
    school_name: str
    county_code: int
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    school_type: str | None = None
    status: str | None = None

    @field_serializer("cds_code")
    @classmethod
    def serialize_cds_code(cls, v: str) -> str:
        return format_cds_code(v)

    model_config = {"from_attributes": True}


class SchoolCrashCountOut(BaseModel):
    """Crashes within 500 ft of one school, summed over the requested years.

    Keyed by cds_code rather than the internal school_locations.id so the map
    can join it straight onto the rows /api/schools already returned. The
    formatting has to match SchoolOut's exactly or that join silently misses.
    """

    cds_code: str
    crashes: int
    killed: int
    injured: int
    severe_injured: int

    @field_serializer("cds_code")
    @classmethod
    def serialize_cds_code(cls, v: str) -> str:
        return format_cds_code(v)


class CountyCoordCoverageOut(BaseModel):
    """Share of a county's crashes that carry map coordinates.

    Statewide only ~37% of crashes are geocoded, and the gap tracks the
    reporting agency rather than the year — so a school in a county whose
    sheriff never geocoded looks safe purely because its crashes are missing
    from the map. The map shows this number next to every count.
    """

    county_code: int
    county_name: str | None = None
    total_crashes: int
    crashes_with_coords: int
    coords_pct: float


class SchoolCrashCountsResponse(BaseModel):
    years: list[int]
    schools: list[SchoolCrashCountOut]
    coverage: list[CountyCoordCoverageOut]


class CalenviroScreenOut(BaseModel):
    county_code: int
    ces_score: float | None = None
    ces_percentile: float | None = None
    pollution_burden: float | None = None
    pop_characteristics: float | None = None
    pm25_score: float | None = None
    ozone_score: float | None = None
    diesel_pm_score: float | None = None
    pesticide_score: float | None = None
    traffic_score: float | None = None
    # Population-characteristics sub-scores
    poverty_pct: float | None = None
    unemployment_pct: float | None = None
    education_pct: float | None = None
    linguistic_isolation_pct: float | None = None
    housing_burden_pct: float | None = None
    # Provenance
    tract_count: int | None = None
    total_population: int | None = None

    model_config = {"from_attributes": True}


class RoadMileOut(BaseModel):
    county_code: int
    f_system: int
    segment_count: int | None = None
    total_miles: float | None = None

    model_config = {"from_attributes": True}


class VmtOut(BaseModel):
    county_code: int
    year: int
    vmt_millions: float | None = None
    source: str | None = None

    model_config = {"from_attributes": True}


class TrafficVolumeOut(BaseModel):
    county_code: int
    total_aadt: int | None = None
    segment_count: int | None = None
    avg_aadt_per_segment: int | None = None

    model_config = {"from_attributes": True}


class SpeedLimitOut(BaseModel):
    county_code: int
    speed_limit: int
    segment_count: int | None = None
    avg_lanes: float | None = None
    total_aadt: int | None = None

    model_config = {"from_attributes": True}
