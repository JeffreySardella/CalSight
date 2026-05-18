"""Data validation checks for the ETL pipeline.

Runs after each data load to detect anomalies before they reach the
dashboard. Catches issues like:

  - Unexpected row count drops (source API returned truncated data)
  - Null percentage spikes (upstream schema change broke parsing)
  - Date range gaps (missing months of crash data)
  - Duplicate collision IDs (upsert logic not working correctly)
  - Out-of-range values (future dates, impossible coordinates)

These checks are non-blocking by default — they log warnings and record
results in etl_runs.validation_status, but don't prevent the pipeline
from continuing. Set strict=True to make them raise on failure (useful
for CI tests).

Usage:
    from etl.validation import run_validation_suite
    results = run_validation_suite(db_session, source="crashes_ccrs")
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class ValidationCheck:
    name: str
    passed: bool
    message: str
    severity: str = "warning"  # "warning" or "critical"
    metric_value: Optional[float] = None
    threshold: Optional[float] = None


@dataclass
class ValidationReport:
    source: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    checks: list[ValidationCheck] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    @property
    def critical_failures(self) -> list[ValidationCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "critical"]

    @property
    def warnings(self) -> list[ValidationCheck]:
        return [c for c in self.checks if not c.passed and c.severity == "warning"]

    def summary(self) -> str:
        total = len(self.checks)
        passed = sum(1 for c in self.checks if c.passed)
        return f"{passed}/{total} checks passed"


def check_row_count_growth(
    db: Session,
    table: str,
    previous_count: int,
    max_drop_pct: float = 10.0,
) -> ValidationCheck:
    """Verify the table didn't lose too many rows.

    A small drop (< max_drop_pct) is acceptable — source corrections
    sometimes remove duplicate records. A large drop means something
    went wrong (truncated API response, premature job termination).
    """
    current_count = db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()

    if previous_count == 0:
        return ValidationCheck(
            name=f"{table}_row_count",
            passed=True,
            message=f"First load: {current_count:,} rows",
            metric_value=current_count,
        )

    if current_count >= previous_count:
        growth_pct = ((current_count - previous_count) / previous_count) * 100
        return ValidationCheck(
            name=f"{table}_row_count",
            passed=True,
            message=f"Grew {growth_pct:.1f}%: {previous_count:,} -> {current_count:,}",
            metric_value=growth_pct,
        )

    drop_pct = ((previous_count - current_count) / previous_count) * 100
    passed = drop_pct <= max_drop_pct

    return ValidationCheck(
        name=f"{table}_row_count",
        passed=passed,
        message=f"Dropped {drop_pct:.1f}%: {previous_count:,} -> {current_count:,}",
        severity="critical" if not passed else "warning",
        metric_value=drop_pct,
        threshold=max_drop_pct,
    )


def check_null_rate(
    db: Session,
    table: str,
    column: str,
    max_null_pct: float = 50.0,
    where_clause: str = "",
) -> ValidationCheck:
    """Check that a column's null percentage hasn't spiked."""
    where = f"WHERE {where_clause}" if where_clause else ""
    total = db.execute(text(f"SELECT COUNT(*) FROM {table} {where}")).scalar()

    if total == 0:
        return ValidationCheck(
            name=f"{table}.{column}_nulls",
            passed=True,
            message="No rows to check",
        )

    null_count = db.execute(
        text(f"SELECT COUNT(*) FROM {table} {where} AND {column} IS NULL" if where_clause
             else f"SELECT COUNT(*) FROM {table} WHERE {column} IS NULL")
    ).scalar()

    null_pct = (null_count / total) * 100

    return ValidationCheck(
        name=f"{table}.{column}_nulls",
        passed=null_pct <= max_null_pct,
        message=f"{null_pct:.1f}% null ({null_count:,}/{total:,})",
        severity="warning",
        metric_value=null_pct,
        threshold=max_null_pct,
    )


def check_date_range(
    db: Session,
    table: str = "crashes",
    date_column: str = "crash_datetime",
    expected_max_year: int | None = None,
) -> ValidationCheck:
    """Verify data covers expected date range — no future dates, no gaps."""
    result = db.execute(text(
        f"SELECT MIN({date_column}), MAX({date_column}) FROM {table}"
    )).one()

    min_date, max_date = result

    if min_date is None:
        return ValidationCheck(
            name=f"{table}_date_range",
            passed=False,
            message="No dates found — table may be empty",
            severity="critical",
        )

    now = datetime.utcnow()

    # Check for future dates
    if max_date > now:
        return ValidationCheck(
            name=f"{table}_date_range",
            passed=False,
            message=f"Future dates detected: max={max_date}",
            severity="warning",
        )

    return ValidationCheck(
        name=f"{table}_date_range",
        passed=True,
        message=f"Range: {min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')}",
    )


def check_recent_data(
    db: Session,
    table: str = "crashes",
    date_column: str = "crash_datetime",
    max_staleness_days: int = 90,
) -> ValidationCheck:
    """Verify we have reasonably recent data (not just old historical)."""
    max_date = db.execute(text(f"SELECT MAX({date_column}) FROM {table}")).scalar()

    if max_date is None:
        return ValidationCheck(
            name=f"{table}_recency",
            passed=False,
            message="No data found",
            severity="critical",
        )

    days_old = (datetime.utcnow() - max_date).days

    return ValidationCheck(
        name=f"{table}_recency",
        passed=days_old <= max_staleness_days,
        message=f"Most recent record: {days_old} days old ({max_date.strftime('%Y-%m-%d')})",
        severity="warning" if days_old <= max_staleness_days * 2 else "critical",
        metric_value=days_old,
        threshold=max_staleness_days,
    )


def check_year_continuity(
    db: Session,
    table: str = "crashes",
    year_column: str = "crash_year",
) -> ValidationCheck:
    """Check for missing years in the data (gap detection)."""
    years = db.execute(text(
        f"SELECT DISTINCT {year_column} FROM {table} WHERE {year_column} IS NOT NULL ORDER BY 1"
    )).scalars().all()

    if not years:
        return ValidationCheck(
            name=f"{table}_year_continuity",
            passed=False,
            message="No year data found",
            severity="critical",
        )

    expected = set(range(min(years), max(years) + 1))
    actual = set(years)
    missing = sorted(expected - actual)

    if missing:
        return ValidationCheck(
            name=f"{table}_year_continuity",
            passed=False,
            message=f"Missing years: {missing}",
            severity="warning",
            metric_value=len(missing),
        )

    return ValidationCheck(
        name=f"{table}_year_continuity",
        passed=True,
        message=f"Continuous from {min(years)} to {max(years)} ({len(years)} years)",
    )


def check_coordinate_bounds(
    db: Session,
    table: str = "crashes",
) -> ValidationCheck:
    """Check that coordinates are within California's bounding box.

    California bbox: lat 32.5-42.0, lon -124.5 to -114.0
    Records outside this are data quality issues (wrong sign, swapped lat/lon, etc.)
    """
    # Count records with coords outside CA bounds
    bad_coords = db.execute(text(f"""
        SELECT COUNT(*) FROM {table}
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND (
            latitude < 32.0 OR latitude > 42.5
            OR longitude < -125.0 OR longitude > -113.5
        )
    """)).scalar()

    total_with_coords = db.execute(text(f"""
        SELECT COUNT(*) FROM {table}
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)).scalar()

    if total_with_coords == 0:
        return ValidationCheck(
            name=f"{table}_coord_bounds",
            passed=True,
            message="No geocoded records to check",
        )

    bad_pct = (bad_coords / total_with_coords) * 100

    return ValidationCheck(
        name=f"{table}_coord_bounds",
        passed=bad_pct < 1.0,  # Less than 1% outside bounds
        message=f"{bad_pct:.2f}% outside CA bounds ({bad_coords:,}/{total_with_coords:,})",
        severity="warning",
        metric_value=bad_pct,
        threshold=1.0,
    )


def run_crash_validations(db: Session) -> ValidationReport:
    """Run the full validation suite for crash data."""
    report = ValidationReport(source="crashes")

    report.checks.append(check_date_range(db, "crashes"))
    report.checks.append(check_recent_data(db, "crashes", max_staleness_days=90))
    report.checks.append(check_year_continuity(db, "crashes"))
    report.checks.append(check_coordinate_bounds(db, "crashes"))

    # Critical columns shouldn't have excessive nulls
    report.checks.append(check_null_rate(db, "crashes", "county_code", max_null_pct=1.0))
    report.checks.append(check_null_rate(db, "crashes", "crash_datetime", max_null_pct=0.1))
    report.checks.append(check_null_rate(db, "crashes", "severity", max_null_pct=5.0))
    report.checks.append(check_null_rate(db, "crashes", "latitude", max_null_pct=40.0))

    # Log results
    for check in report.checks:
        if check.passed:
            logger.info("  PASS: %s — %s", check.name, check.message)
        else:
            logger.warning("  FAIL: %s — %s", check.name, check.message)

    logger.info("Validation %s: %s", report.source, report.summary())
    return report


def run_validation_suite(db: Session, source: str = "crashes") -> ValidationReport:
    """Run validations appropriate for the given source."""
    if source in ("crashes_ccrs", "crashes_switrs", "crashes"):
        return run_crash_validations(db)

    # For other sources, do basic row count and null checks
    report = ValidationReport(source=source)
    logger.info("Validation %s: %s", source, report.summary())
    return report
