from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ValidationResult:
    passed: bool
    source: str
    check: str
    message: str


def validate_row_count(
    source: str,
    before: int,
    after: int,
    max_drop_pct: float = 10.0,
) -> ValidationResult:
    if before == 0:
        return ValidationResult(
            passed=True,
            source=source,
            check="row_count",
            message=f"First load: {after} rows",
        )

    if after >= before:
        return ValidationResult(
            passed=True,
            source=source,
            check="row_count",
            message=f"Row count grew: {before} -> {after}",
        )

    drop_pct = ((before - after) / before) * 100
    passed = drop_pct <= max_drop_pct
    return ValidationResult(
        passed=passed,
        source=source,
        check="row_count",
        message=f"Row count dropped {drop_pct:.1f}%: {before} -> {after}"
        + ("" if passed else f" (threshold: {max_drop_pct}%)"),
    )


def validate_no_nulls_spike(
    source: str,
    field: str,
    null_pct_before: float,
    null_pct_after: float,
    max_increase_pct: float = 5.0,
) -> ValidationResult:
    increase = null_pct_after - null_pct_before
    passed = increase <= max_increase_pct
    return ValidationResult(
        passed=passed,
        source=source,
        check=f"nulls_{field}",
        message=f"{field} nulls: {null_pct_before:.1f}% -> {null_pct_after:.1f}%"
        + ("" if passed else f" (max increase: {max_increase_pct}%)"),
    )
