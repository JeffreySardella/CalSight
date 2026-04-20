"""Crash-people endpoints: parties (drivers/peds/cyclists involved) and
victims (injured/killed people in a crash).

Two scopes:
  - Drill-down: /api/crashes/{collision_id}/parties|victims for one crash
  - Cross-crash list: /api/parties|victims with optional filters

Join key: rows in `crash_parties` and `crash_victims` carry
`(collision_id, data_source)`. SWITRS and CCRS use overlapping numeric
collision_ids, so any join to `crashes` MUST use both columns. See
`docs/db-schema.md` for the 3.85M-collision-id-overlap detail.
"""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.county_slug_map import get_slug_map
from app.database import get_db
from app.filters import (
    FilterError,
    parse_county_codes,
    parse_year,
)
from app.models import Crash, CrashParty, CrashVictim
from app.schemas.common import PaginatedResponse
from app.schemas.crash_people import CrashPartyOut, CrashVictimOut

router = APIRouter(tags=["crash-people"])


# ── Drill-down endpoints (B1) ──────────────────────────────────────────


@router.get(
    "/crashes/{collision_id}/parties",
    response_model=list[CrashPartyOut],
)
def list_parties_for_crash(
    response: Response,
    collision_id: int,
    data_source: str = Query(..., pattern="^(ccrs|switrs)$"),
    db: Session = Depends(get_db),
):
    """All parties (drivers, pedestrians, cyclists) for one crash.

    `data_source` is required because (collision_id, data_source) is the
    real join key — SWITRS and CCRS share the same numeric collision_id
    space (3.85M overlapping IDs).

    Example: `/api/crashes/2573749/parties?data_source=ccrs`
    """
    response.headers["Cache-Control"] = "public, max-age=300"
    rows = (
        db.query(CrashParty)
        .filter(
            CrashParty.collision_id == collision_id,
            CrashParty.data_source == data_source,
        )
        .order_by(CrashParty.party_number)
        .all()
    )
    return [CrashPartyOut.model_validate(r) for r in rows]


@router.get(
    "/crashes/{collision_id}/victims",
    response_model=list[CrashVictimOut],
)
def list_victims_for_crash(
    response: Response,
    collision_id: int,
    data_source: str = Query(..., pattern="^(ccrs|switrs)$"),
    db: Session = Depends(get_db),
):
    """All victims (injured, killed, witnesses, passengers) for one crash.

    `data_source` is required (see /api/crashes/{collision_id}/parties).
    """
    response.headers["Cache-Control"] = "public, max-age=300"
    rows = (
        db.query(CrashVictim)
        .filter(
            CrashVictim.collision_id == collision_id,
            CrashVictim.data_source == data_source,
        )
        .order_by(CrashVictim.party_number)
        .all()
    )
    return [CrashVictimOut.model_validate(r) for r in rows]


# ── Cross-crash list endpoints (B2) ────────────────────────────────────


def _parse_age_range(age_min: int | None, age_max: int | None) -> tuple[int | None, int | None]:
    if age_min is not None and age_min < 0:
        raise FilterError("age_min", "age_min must be >= 0.")
    if age_max is not None and age_max < 0:
        raise FilterError("age_max", "age_max must be >= 0.")
    if age_min is not None and age_max is not None and age_min > age_max:
        raise FilterError("age_min", "age_min must be <= age_max.")
    return age_min, age_max


def _parse_gender(raw: str | None) -> set[str] | None:
    """Gender filter: accepts m/f/u (case-insensitive). DB stores M/F/U."""
    if raw is None or raw == "":
        return None
    out: set[str] = set()
    for part in raw.split(","):
        token = part.strip().upper()
        if not token:
            continue
        if token not in {"M", "F", "U"}:
            raise FilterError(
                "gender",
                f"Unknown gender '{token}'. Allowed: m, f, u.",
            )
        out.add(token)
    return out or None


@router.get("/parties", response_model=PaginatedResponse[CrashPartyOut])
def list_parties(
    response: Response,
    collision_id: int | None = Query(None),
    data_source: str | None = Query(None, pattern="^(ccrs|switrs)$"),
    county: str | None = Query(None),
    year: str | None = Query(None),
    gender: str | None = Query(None),
    age_min: int | None = Query(None, ge=0, le=130),
    age_max: int | None = Query(None, ge=0, le=130),
    party_type: str | None = Query(None),
    at_fault: bool | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Paginated cross-crash party query.

    Filters:
      - `collision_id` + `data_source`: drill into one crash (same as
        /api/crashes/{collision_id}/parties but with paging)
      - `county` (slug, multi), `year` (multi): JOINs to `crashes` on
        (collision_id, data_source); slow without #106's covering index
      - `gender=m,f,u`, `age_min`, `age_max`, `party_type`, `at_fault=true|false`:
        direct column filters

    `total` is always null here — counting party rows across millions
    is too slow without indexes. Use `/api/stats?group_by=...` for totals.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    age_min_v, age_max_v = _parse_age_range(age_min, age_max)
    gender_set = _parse_gender(gender)

    q = db.query(CrashParty)

    if collision_id is not None:
        q = q.filter(CrashParty.collision_id == collision_id)
    if data_source is not None:
        q = q.filter(CrashParty.data_source == data_source)

    needs_join = bool(county) or bool(year)
    if needs_join:
        q = q.join(
            Crash,
            (Crash.collision_id == CrashParty.collision_id)
            & (Crash.data_source == CrashParty.data_source),
        )
        if county:
            codes = parse_county_codes(county, get_slug_map(db))
            if codes:
                q = q.filter(Crash.county_code.in_(codes))
        if year:
            years = parse_year(year)
            if years:
                q = q.filter(Crash.crash_year.in_(years))

    if gender_set:
        q = q.filter(CrashParty.gender.in_(gender_set))
    if age_min_v is not None:
        q = q.filter(CrashParty.age >= age_min_v)
    if age_max_v is not None:
        q = q.filter(CrashParty.age <= age_max_v)
    if party_type is not None:
        q = q.filter(CrashParty.party_type == party_type)
    if at_fault is not None:
        q = q.filter(CrashParty.at_fault.is_(at_fault))

    rows = q.order_by(CrashParty.id.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse[CrashPartyOut](
        limit=limit,
        offset=offset,
        items=[CrashPartyOut.model_validate(r) for r in rows],
        total=None,
    )


@router.get("/victims", response_model=PaginatedResponse[CrashVictimOut])
def list_victims(
    response: Response,
    collision_id: int | None = Query(None),
    data_source: str | None = Query(None, pattern="^(ccrs|switrs)$"),
    county: str | None = Query(None),
    year: str | None = Query(None),
    gender: str | None = Query(None),
    age_min: int | None = Query(None, ge=0, le=130),
    age_max: int | None = Query(None, ge=0, le=130),
    person_type: str | None = Query(None),
    injury_severity: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Paginated cross-crash victim query (injured + killed + witnesses).

    Filters: same shape as /api/parties, plus `person_type` (Driver,
    Pedestrian, Bicyclist, Passenger) and `injury_severity` (Fatal,
    Severe, Possible, etc. — raw CCRS values; not the same vocabulary
    as crashes.severity).

    `total` is always null — see /api/parties for rationale.
    """
    response.headers["Cache-Control"] = "public, max-age=300"

    age_min_v, age_max_v = _parse_age_range(age_min, age_max)
    gender_set = _parse_gender(gender)

    q = db.query(CrashVictim)

    if collision_id is not None:
        q = q.filter(CrashVictim.collision_id == collision_id)
    if data_source is not None:
        q = q.filter(CrashVictim.data_source == data_source)

    needs_join = bool(county) or bool(year)
    if needs_join:
        q = q.join(
            Crash,
            (Crash.collision_id == CrashVictim.collision_id)
            & (Crash.data_source == CrashVictim.data_source),
        )
        if county:
            codes = parse_county_codes(county, get_slug_map(db))
            if codes:
                q = q.filter(Crash.county_code.in_(codes))
        if year:
            years = parse_year(year)
            if years:
                q = q.filter(Crash.crash_year.in_(years))

    if gender_set:
        q = q.filter(CrashVictim.gender.in_(gender_set))
    if age_min_v is not None:
        q = q.filter(CrashVictim.age >= age_min_v)
    if age_max_v is not None:
        q = q.filter(CrashVictim.age <= age_max_v)
    if person_type is not None:
        q = q.filter(CrashVictim.person_type == person_type)
    if injury_severity is not None:
        q = q.filter(CrashVictim.injury_severity == injury_severity)

    rows = q.order_by(CrashVictim.id.desc()).offset(offset).limit(limit).all()
    return PaginatedResponse[CrashVictimOut](
        limit=limit,
        offset=offset,
        items=[CrashVictimOut.model_validate(r) for r in rows],
        total=None,
    )
