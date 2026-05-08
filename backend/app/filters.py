"""URL-param <-> SQL predicate translation, shared by /api/crashes and /api/stats.

Conventions:
  - parse_* returns None for "no filter on this dimension" (omitted or empty param)
  - parse_* returns a set[int] or set[str] of DB-truthful values otherwise
  - parse_* raises FilterError with a helpful message on bad input

Router handlers let FilterError propagate; a global exception handler in
`app.main` converts it to 422 with `{detail, filter}`, matching the
error envelope documented in the spec.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import ColumnElement

from app.models import Crash


class FilterError(ValueError):
    def __init__(self, filter: str, detail: str):
        super().__init__(detail)
        self.filter = filter
        self.detail = detail


_FIRST_YEAR = 2001


def _split_csv(raw: str) -> list[str]:
    return [p.strip() for p in raw.split(",") if p.strip()]


def parse_year(raw: str | None) -> set[int] | None:
    """Parse ?year=2020,2023 into {2020, 2023}. None/"" -> no filter."""
    if raw is None or raw == "":
        return None
    current_year = date.today().year
    out: set[int] = set()
    for part in _split_csv(raw):
        try:
            y = int(part)
        except ValueError:
            raise FilterError(
                "year",
                f"Year values must be integers; got '{part}'.",
            ) from None
        if y < _FIRST_YEAR or y > current_year:
            raise FilterError(
                "year",
                f"Year {y} is outside the supported range "
                f"({_FIRST_YEAR}-{current_year}).",
            )
        out.add(y)
    return out or None


def parse_county_codes(
    raw: str | None,
    slug_map: dict[str, int],
) -> set[int] | None:
    """Parse ?county=los-angeles,orange into {19, 30} (codes)."""
    if raw is None or raw == "":
        return None
    out: set[int] = set()
    for part in _split_csv(raw):
        code = slug_map.get(part)
        if code is None:
            examples = ", ".join(sorted(slug_map.keys())[:5])
            raise FilterError(
                "county",
                f"Unknown county '{part}'. Examples: {examples}, ...",
            )
        out.add(code)
    return out or None


# Canonical DB values, mapped from URL slugs.
_SEVERITY_SLUG_TO_DB = {
    "fatal": "Fatal",
    "injury": "Injury",
    "property-damage-only": "Property Damage Only",
}

# Canonical DB canonical_cause values.
_CAUSE_SLUG_TO_DB = {
    "dui": "dui",
    "speeding": "speeding",
    "lane-change": "lane_change",
    "right-of-way": "right_of_way",
    "turning": "turning",
    "following-too-close": "following_too_close",
    "signal-violation": "signal_violation",
    "pedestrian-violation": "pedestrian_violation",
    "unsafe-backing": "unsafe_backing",
    "other": "other",
}


def parse_severity(raw: str | None) -> set[str] | None:
    if raw is None or raw == "":
        return None
    out: set[str] = set()
    for part in _split_csv(raw):
        db_value = _SEVERITY_SLUG_TO_DB.get(part)
        if db_value is None:
            allowed = ", ".join(_SEVERITY_SLUG_TO_DB.keys())
            raise FilterError(
                "severity",
                f"Unknown severity '{part}'. Allowed: {allowed}.",
            )
        out.add(db_value)
    return out or None


def parse_cause(raw: str | None) -> set[str] | None:
    if raw is None or raw == "":
        return None
    out: set[str] = set()
    for part in _split_csv(raw):
        if part == "distracted":
            raise FilterError(
                "cause",
                "'distracted' is not a cause category. Use ?distracted=true.",
            )
        if part == "weather":
            raise FilterError(
                "cause",
                "'weather' is not a cause category. Weather conditions are "
                "available on individual crash records via crashes.weather.",
            )
        db_value = _CAUSE_SLUG_TO_DB.get(part)
        if db_value is None:
            allowed = ", ".join(_CAUSE_SLUG_TO_DB.keys())
            raise FilterError(
                "cause",
                f"Unknown cause '{part}'. Allowed: {allowed}.",
            )
        out.add(db_value)
    return out or None


def parse_bool_flag(raw: str | None, name: str) -> bool | None:
    if raw is None or raw == "":
        return None
    if raw == "true":
        return True
    if raw == "false":
        return False
    raise FilterError(
        name,
        f"{name} must be 'true' or 'false'; got '{raw}'.",
    )


def parse_driver_age(raw: str | None) -> tuple[int, int] | None:
    """Parse ?driver_age=16-21 or ?driver_age=65+ into (min, max) tuple."""
    if raw is None or raw == "":
        return None
    raw = raw.strip()
    if raw.endswith("+"):
        try:
            min_age = int(raw[:-1])
        except ValueError:
            raise FilterError("driver_age", f"Invalid age bracket '{raw}'.") from None
        return (min_age, 200)
    if "-" in raw:
        parts = raw.split("-", 1)
        try:
            min_age, max_age = int(parts[0]), int(parts[1])
        except ValueError:
            raise FilterError("driver_age", f"Invalid age bracket '{raw}'.") from None
        if min_age > max_age:
            raise FilterError("driver_age", f"Min age {min_age} > max age {max_age}.")
        return (min_age, max_age)
    raise FilterError(
        "driver_age",
        f"Expected format '16-21' or '65+'; got '{raw}'.",
    )


def build_crash_predicates(
    *,
    years: set[int] | None = None,
    county_codes: set[int] | None = None,
    severities: set[str] | None = None,
    causes: set[str] | None = None,
    alcohol: bool | None = None,
    distracted: bool | None = None,
    pedestrian: bool | None = None,
    cyclist: bool | None = None,
    drug: bool | None = None,
    driver_age: tuple[int, int] | None = None,
) -> list[ColumnElement]:
    """Build SQLAlchemy WHERE predicates for the crashes table."""
    preds: list[ColumnElement] = []
    if years:
        preds.append(Crash.crash_year.in_(years))
    if county_codes:
        preds.append(Crash.county_code.in_(county_codes))
    if severities:
        preds.append(Crash.severity.in_(severities))
    if causes:
        preds.append(Crash.canonical_cause.in_(causes))
    if alcohol is not None:
        preds.append(Crash.is_alcohol_involved.is_(alcohol))
    if distracted is not None:
        preds.append(Crash.is_distraction_involved.is_(distracted))
    if pedestrian is not None:
        preds.append(Crash.pedestrian_involved.is_(pedestrian))
    if cyclist is not None:
        preds.append(Crash.cyclist_involved.is_(cyclist))
    if drug is not None:
        preds.append(Crash.is_drug_involved.is_(drug))
    if driver_age is not None:
        preds.append(Crash.at_fault_driver_age.between(driver_age[0], driver_age[1]))
    return preds
