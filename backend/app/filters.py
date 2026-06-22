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

from calendar import monthrange
from datetime import date, datetime, time

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


# Date range — month-resolution start/end (?start=2020-01&end=2023-12).
DateRange = tuple[date | None, date | None]


def _parse_year_month(raw: str, filter_name: str) -> tuple[int, int]:
    parts = raw.split("-")
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        raise FilterError(
            filter_name,
            f"{filter_name} must be in YYYY-MM format; got '{raw}'.",
        )
    try:
        y = int(parts[0])
        m = int(parts[1])
    except ValueError:
        raise FilterError(
            filter_name,
            f"{filter_name} must be in YYYY-MM format; got '{raw}'.",
        ) from None
    current_year = date.today().year
    if y < _FIRST_YEAR or y > current_year:
        raise FilterError(
            filter_name,
            f"Year {y} is outside the supported range "
            f"({_FIRST_YEAR}-{current_year}).",
        )
    if m < 1 or m > 12:
        raise FilterError(
            filter_name,
            f"Month must be 1-12; got {m}.",
        )
    return y, m


def parse_date_range(start: str | None, end: str | None) -> DateRange | None:
    """Parse ?start=YYYY-MM&end=YYYY-MM into a (start_date, end_date) tuple.

    `start` becomes the first day of the start month; `end` becomes the
    last day of the end month (inclusive). Either side may be omitted.
    Returns None when both inputs are empty/missing.
    """
    has_start = start is not None and start != ""
    has_end = end is not None and end != ""
    if not has_start and not has_end:
        return None

    start_d: date | None = None
    end_d: date | None = None

    if has_start:
        sy, sm = _parse_year_month(start, "start")  # type: ignore[arg-type]
        start_d = date(sy, sm, 1)
    if has_end:
        ey, em = _parse_year_month(end, "end")  # type: ignore[arg-type]
        end_d = date(ey, em, monthrange(ey, em)[1])

    if start_d and end_d and start_d > end_d:
        raise FilterError(
            "end",
            f"end ({end}) must be on or after start ({start}).",
        )

    return start_d, end_d


def years_from_date_range(date_range: DateRange | None) -> set[int] | None:
    """Convert a date range into the set of years it spans.

    Used for endpoints that aggregate against year-resolution materialized
    views; month-level precision is rounded outward.
    """
    if date_range is None:
        return None
    start_d, end_d = date_range
    start_y = start_d.year if start_d else _FIRST_YEAR
    end_y = end_d.year if end_d else date.today().year
    if start_y > end_y:
        return set()
    return set(range(start_y, end_y + 1))


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


def parse_weather(raw: str | None) -> list[str] | None:
    if raw is None or raw == "":
        return None
    valid = {"clear", "cloudy", "rain", "fog", "snow", "wind", "other"}
    values = [v.strip() for v in raw.split(",")]
    bad = [v for v in values if v not in valid]
    if bad:
        raise FilterError("weather", f"Unknown weather '{bad[0]}'. Allowed: {', '.join(sorted(valid))}.")
    return values or None


def parse_lighting(raw: str | None) -> list[str] | None:
    if raw is None or raw == "":
        return None
    valid = {"daylight", "dark_lit", "dark_unlit", "dusk_dawn", "other"}
    values = [v.strip() for v in raw.split(",")]
    bad = [v for v in values if v not in valid]
    if bad:
        raise FilterError("lighting", f"Unknown lighting '{bad[0]}'. Allowed: {', '.join(sorted(valid))}.")
    return values or None


def parse_collision_type(raw: str | None) -> list[str] | None:
    if raw is None or raw == "":
        return None
    valid = {"rear_end", "broadside", "sideswipe", "hit_object", "head_on", "other"}
    values = [v.strip() for v in raw.split(",")]
    bad = [v for v in values if v not in valid]
    if bad:
        raise FilterError("collision_type", f"Unknown collision_type '{bad[0]}'. Allowed: {', '.join(sorted(valid))}.")
    return values or None


def parse_road_type(raw: str | None) -> bool | None:
    if raw is None or raw == "":
        return None
    if raw == "highway":
        return True
    if raw == "local":
        return False
    raise FilterError("road_type", "road_type must be 'highway' or 'local'.")


def parse_hit_run(raw: str | None) -> bool | None:
    return parse_bool_flag(raw, "hit_run")


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
    date_range: DateRange | None = None,
    county_codes: set[int] | None = None,
    severities: set[str] | None = None,
    causes: set[str] | None = None,
    alcohol: bool | None = None,
    distracted: bool | None = None,
    pedestrian: bool | None = None,
    cyclist: bool | None = None,
    drug: bool | None = None,
    driver_age: tuple[int, int] | None = None,
    weather: list[str] | None = None,
    lighting: list[str] | None = None,
    collision_type: list[str] | None = None,
    road_type: bool | None = None,
    hit_run: bool | None = None,
) -> list[ColumnElement]:
    """Build SQLAlchemy WHERE predicates for the crashes table.

    `date_range` filters on `crash_datetime` at month resolution and takes
    precedence over `years` when both are supplied.
    """
    preds: list[ColumnElement] = []
    if date_range is not None:
        start_d, end_d = date_range
        if start_d:
            preds.append(Crash.crash_datetime >= datetime.combine(start_d, time.min))
        if end_d:
            preds.append(Crash.crash_datetime <= datetime.combine(end_d, time.max))
    elif years:
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
    if weather:
        preds.append(Crash.canonical_weather.in_(weather))
    if lighting:
        preds.append(Crash.canonical_lighting.in_(lighting))
    if collision_type:
        preds.append(Crash.canonical_collision_type.in_(collision_type))
    if road_type is not None:
        preds.append(Crash.is_highway.is_(road_type))
    if hit_run is not None:
        if hit_run:
            preds.append(Crash.hit_run.isnot(None))
        else:
            preds.append(Crash.hit_run.is_(None))
    return preds


def require_min_filter(
    *,
    county_codes: set[int] | None,
    years: set[int] | None,
    date_range: DateRange | None,
    collision_id: int | None = None,
) -> None:
    """Reject totally unfiltered bulk reads on PII-sensitive endpoints.

    A pageable endpoint that exposes individual-level data (crash rows with
    coords, or per-party/per-victim demographics) lowers the barrier to bulk
    re-identification if it can be walked from offset=0 with no filter set.
    Requiring at least one of county, year/date range, or a single-crash
    collision_id keeps the result set narrow enough that scraping isn't a
    one-curl operation.

    Raises FilterError → 422 with the documented `{detail, filter}` envelope.
    """
    if (county_codes is not None
            or years is not None
            or date_range is not None
            or collision_id is not None):
        return
    raise FilterError(
        "filter",
        "At least one filter is required: county, year, start/end, "
        "or collision_id. Unfiltered bulk reads are not permitted on "
        "this endpoint.",
    )
