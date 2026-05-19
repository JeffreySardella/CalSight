"""Response models for /api/crashes/{collision_id}/parties|victims and
/api/parties|victims endpoints.

PII suppression: individual-level age is generalized to age_bracket,
sobriety detail is reduced to a boolean impaired flag. This limits
re-identification risk while preserving analytical value.
"""

from pydantic import BaseModel, model_validator


def _age_to_bracket(age: int | None) -> str | None:
    if age is None:
        return None
    if age < 16:
        return "Under 16"
    if age < 25:
        return "16-24"
    if age < 35:
        return "25-34"
    if age < 45:
        return "35-44"
    if age < 55:
        return "45-54"
    if age < 65:
        return "55-64"
    return "65+"


_SOBER_VALUES = frozenset({
    "HAD NOT BEEN DRINKING",
    "NOT APPLICABLE",
    "NOT DRUNK",
    "",
})


class CrashPartyOut(BaseModel):
    id: int
    party_id: int
    collision_id: int
    data_source: str | None = None
    party_number: int | None = None
    party_type: str | None = None
    at_fault: bool | None = None
    gender: str | None = None
    age_bracket: str | None = None
    impaired: bool | None = None
    vehicle_type: str | None = None
    vehicle_year: int | None = None
    vehicle_make: str | None = None
    speed_limit: int | None = None
    movement: str | None = None
    safety_equipment: str | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def suppress_pii(cls, data):
        if hasattr(data, "__dict__"):
            d = {k: v for k, v in data.__dict__.items() if not k.startswith("_")}
        else:
            d = dict(data)
        d["age_bracket"] = _age_to_bracket(d.pop("age", None))
        sobriety = d.pop("sobriety", None) or ""
        d["impaired"] = sobriety.upper().strip() not in _SOBER_VALUES
        d.pop("cell_phone_use", None)
        return d


class CrashVictimOut(BaseModel):
    id: int
    victim_id: int
    collision_id: int
    data_source: str | None = None
    party_number: int | None = None
    age_bracket: str | None = None
    gender: str | None = None
    injury_severity: str | None = None
    person_type: str | None = None
    seat_position: str | None = None
    safety_equipment: str | None = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def suppress_pii(cls, data):
        if hasattr(data, "__dict__"):
            d = {k: v for k, v in data.__dict__.items() if not k.startswith("_")}
        else:
            d = dict(data)
        d["age_bracket"] = _age_to_bracket(d.pop("age", None))
        d.pop("ejected", None)
        return d
