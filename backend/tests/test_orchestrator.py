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
    assert len(registry.jobs) == 25  # +1: tract_density (Census lived-density source)


def test_default_registry_resolves_without_error():
    registry = build_default_registry()
    order = resolve_execution_order(registry)
    names = [j.name for j in order]
    assert names.index("crashes_ccrs") < names.index("backfill")
    assert names.index("parties") < names.index("backfill")
    assert names.index("crashes_ccrs") < names.index("route_number")
    assert names.index("backfill") < names.index("matviews")
    assert names.index("matviews") < names.index("insights")
    assert names.index("insights") < names.index("vacuum")


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _FakeDB:
    """Minimal Session stand-in: returns queued COUNT(*) results in order."""

    def __init__(self, counts):
        self._counts = list(counts)

    def execute(self, *_args, **_kwargs):
        return _FakeResult(self._counts.pop(0) if self._counts else 0)


def test_validate_job_no_table_is_skipped():
    from etl.orchestrator import _validate_job

    job = Job(name="demographics", module="etl.load_demographics", table_name=None)
    status, summary = _validate_job(_FakeDB([]), job, rows_before=None)
    assert status == "skipped"
    assert summary is None


def test_validate_job_growth_passes():
    from etl.orchestrator import _validate_job

    job = Job(name="parties", module="etl.x", table_name="crash_parties", max_drop_pct=5)
    # current count (queried by check_row_count_growth) grew vs rows_before
    status, _ = _validate_job(_FakeDB([1_050_000]), job, rows_before=1_000_000)
    assert status == "passed"


def test_validate_job_large_drop_fails():
    from etl.orchestrator import _validate_job

    job = Job(name="parties", module="etl.x", table_name="crash_parties", max_drop_pct=5)
    # 50% drop, well beyond max_drop_pct=5 → critical failure → "failed"
    status, summary = _validate_job(_FakeDB([500_000]), job, rows_before=1_000_000)
    assert status == "failed"
    assert "crash_parties_row_count" in summary


def test_validate_job_small_drop_within_threshold_passes():
    from etl.orchestrator import _validate_job

    job = Job(name="parties", module="etl.x", table_name="crash_parties", max_drop_pct=10)
    # 2% drop, within max_drop_pct=10 → not a failure
    status, _ = _validate_job(_FakeDB([980_000]), job, rows_before=1_000_000)
    assert status == "passed"


def test_validate_job_swallows_check_errors():
    from etl.orchestrator import _validate_job

    class _BoomDB:
        def execute(self, *_a, **_k):
            raise RuntimeError("connection lost")

    job = Job(name="parties", module="etl.x", table_name="crash_parties")
    status, summary = _validate_job(_BoomDB(), job, rows_before=1_000_000)
    # A broken check must not fail an otherwise-successful load.
    assert status == "skipped"
    assert "validation error" in summary


def test_table_row_count_rejects_bad_identifier():
    from etl.orchestrator import _table_row_count

    # Never interpolate a suspicious identifier into SQL.
    assert _table_row_count(_FakeDB([5]), "crashes; DROP TABLE x") is None
    assert _table_row_count(_FakeDB([]), None) is None


class _FakeSession:
    """Minimal Session stand-in for run_job: collects added rows, serves COUNTs."""

    def __init__(self, counts=None):
        self.added = []
        self._counts = list(counts or [])

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass

    def refresh(self, obj):
        pass

    def expunge(self, obj):
        pass

    def close(self):
        pass

    def execute(self, *_args, **_kwargs):
        return _FakeResult(self._counts.pop(0) if self._counts else 0)


def test_run_job_writes_naive_utc_timestamps(monkeypatch):
    """EtlRun.started_at/finished_at are naive DateTime columns; the orchestrator
    must write naive UTC (not tz-aware) or staleness math goes offset-dependent
    on non-UTC servers (M-B12)."""
    import types

    from etl import orchestrator

    job = Job(name="x", module="etl.x", table_name=None, source_type="none")
    fake = _FakeSession()
    monkeypatch.setattr(orchestrator, "SessionLocal", lambda: fake)
    monkeypatch.setattr(
        orchestrator.subprocess,
        "run",
        lambda *a, **k: types.SimpleNamespace(returncode=0, stdout="", stderr=""),
    )

    record = orchestrator.run_job(job, force_refresh=True)

    assert record.started_at.tzinfo is None
    assert record.finished_at.tzinfo is None


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
