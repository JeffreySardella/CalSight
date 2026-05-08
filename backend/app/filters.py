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


def build_crash_predicates(
    *,
    years: set[int] | None = None,
    date_range: DateRange | None = None,
    county_codes: set[int] | None = None,
    severities: set[str] | None = None,
    causes: set[str] | None = None,
    alcohol: bool | None = None,
    distracted: bool | None = None,
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
    return preds
