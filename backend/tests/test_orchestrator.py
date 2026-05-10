import subprocess
import sys

import pytest

from app.models import EtlRun
from etl.orchestrator import JobRegistry, Job, resolve_execution_order
from etl.jobs import build_default_registry


def test_etl_run_has_orchestrator_fields():
    fields = {c.name for c in EtlRun.__table__.columns}
    assert "validation_status" in fields
    assert "rows_before" in fields
    assert "rows_after" in fields
    assert "diff_summary" in fields
    assert "triggered_by" in fields


def test_register_and_list_jobs():
    registry = JobRegistry()
    registry.register(Job(
        name="crashes",
        module="etl.load_crashes",
        args=["--start", "2016", "--end", "2026", "--source", "ccrs"],
        depends_on=[],
        schedule="daily",
        max_drop_pct=5,
    ))
    registry.register(Job(
        name="demographics",
        module="etl.load_demographics",
        args=[],
        depends_on=[],
        schedule="weekly",
        max_drop_pct=10,
    ))
    assert len(registry.jobs) == 2
    assert registry.get("crashes").name == "crashes"


def test_resolve_execution_order_respects_dependencies():
    registry = JobRegistry()
    registry.register(Job(name="crashes", module="etl.load_crashes", depends_on=[]))
    registry.register(Job(name="parties", module="etl.load_parties_victims", depends_on=["crashes"]))
    registry.register(Job(name="backfill", module="etl.backfill_derived", depends_on=["crashes", "parties"]))
    registry.register(Job(name="demographics", module="etl.load_demographics", depends_on=[]))
    registry.register(Job(name="matviews", module="etl.refresh_materialized_views", depends_on=["backfill"]))

    order = resolve_execution_order(registry)
    names = [j.name for j in order]

    assert names.index("crashes") < names.index("parties")
    assert names.index("parties") < names.index("backfill")
    assert names.index("backfill") < names.index("matviews")


def test_resolve_detects_circular_dependency():
    registry = JobRegistry()
    registry.register(Job(name="a", module="etl.a", depends_on=["b"]))
    registry.register(Job(name="b", module="etl.b", depends_on=["a"]))

    with pytest.raises(ValueError, match="Circular"):
        resolve_execution_order(registry)


def test_resolve_detects_missing_dependency():
    registry = JobRegistry()
    registry.register(Job(name="a", module="etl.a", depends_on=["nonexistent"]))

    with pytest.raises(ValueError, match="nonexistent"):
        resolve_execution_order(registry)


def test_default_registry_has_all_jobs():
    registry = build_default_registry()
    assert len(registry.jobs) == 22


def test_default_registry_resolves_without_error():
    registry = build_default_registry()
    order = resolve_execution_order(registry)
    names = [j.name for j in order]
    assert names.index("crashes_ccrs") < names.index("backfill")
    assert names.index("parties") < names.index("backfill")
    assert names.index("victims") < names.index("backfill")
    assert names.index("backfill") < names.index("matviews")
    assert names.index("matviews") < names.index("insights")
    assert names.index("insights") < names.index("vacuum")


def test_cli_dry_run():
    result = subprocess.run(
        [sys.executable, "-m", "etl.run_all", "--dry-run"],
        capture_output=True,
        text=True,
        cwd=".",
    )
    assert result.returncode == 0
    assert "Execution order" in result.stdout
    assert "crashes_ccrs" in result.stdout
    assert "vacuum" in result.stdout
    assert "crashes_switrs" not in result.stdout
