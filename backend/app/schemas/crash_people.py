"""Response models for /api/crashes/{collision_id}/parties|victims and
/api/parties|victims endpoints."""

from pydantic import BaseModel


class CrashPartyOut(BaseModel):
    id: int
    party_id: int
    collision_id: int
    data_source: str | None = None
    party_number: int | None = None
    party_type: str | None = None
    at_fault: bool | None = None
    gender: str | None = None
    age: int | None = None
    sobriety: str | None = None
    vehicle_type: str | None = None
    vehicle_year: int | None = None
    vehicle_make: str | None = None
    speed_limit: int | None = None
    movement: str | None = None
    safety_equipment: str | None = None
    cell_phone_use: str | None = None

    model_config = {"from_attributes": True}


class CrashVictimOut(BaseModel):
    id: int
    victim_id: int
    collision_id: int
    data_source: str | None = None
    party_number: int | None = None
    age: int | None = None
    gender: str | None = None
    injury_severity: str | None = None
    person_type: str | None = None
    seat_position: str | None = None
    safety_equipment: str | None = None
    ejected: str | None = None

    model_config = {"from_attributes": True}
