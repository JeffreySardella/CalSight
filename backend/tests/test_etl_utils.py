"""Tests for the shared ETL utilities.

Covers:
  - safe_int / safe_float: pure-function coercion edge cases.
  - get_with_retry / post_with_retry: HTTP retry semantics with a mock
    httpx.get/post via monkeypatch, avoiding real network calls.
  - etl_run / track_etl_run: context manager and decorator variants,
    verifying status transitions with a mocked EtlRun + session.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from etl import _utils


# ---------------------------------------------------------------------------
# safe_int / safe_float
# ---------------------------------------------------------------------------

class TestSafeInt:
    def test_int_passthrough(self):
        assert _utils.safe_int(42) == 42

    def test_valid_string(self):
        assert _utils.safe_int("42") == 42

    def test_none(self):
        assert _utils.safe_int(None) is None

    def test_empty_string(self):
        assert _utils.safe_int("") is None

    def test_invalid_string(self):
        assert _utils.safe_int("abc") is None

    def test_float_input(self):
        # int(3.9) truncates to 3 — matches existing _safe_int behavior
        assert _utils.safe_int(3.9) == 3


class TestSafeFloat:
    def test_float_passthrough(self):
        assert _utils.safe_float(3.14) == 3.14

    def test_valid_string(self):
        assert _utils.safe_float("2.5") == 2.5

    def test_int_input(self):
        assert _utils.safe_float(7) == 7.0

    def test_none(self):
        assert _utils.safe_float(None) is None

    def test_empty_string(self):
        assert _utils.safe_float("") is None

    def test_invalid_string(self):
        assert _utils.safe_float("NaN-ish") is None


# ---------------------------------------------------------------------------
# get_with_retry / post_with_retry
# ---------------------------------------------------------------------------

def _make_response(status_code: int, content: bytes = b"{}") -> httpx.Response:
    """Build a real httpx.Response so raise_for_status and json() behave correctly."""
    return httpx.Response(
        status_code=status_code,
        content=content,
        request=httpx.Request("GET", "https://example.test"),
    )


class TestGetWithRetry:
    def test_success_first_try(self, monkeypatch):
        calls = {"n": 0}

        def fake_get(url, **kwargs):
            calls["n"] += 1
            return _make_response(200)

        monkeypatch.setattr(httpx, "get", fake_get)
        # Patch the sleep so tests don't actually pause
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        resp = _utils.get_with_retry("https://example.test")
        assert resp.status_code == 200
        assert calls["n"] == 1

    def test_retries_on_5xx_then_succeeds(self, monkeypatch):
        responses = [_make_response(503), _make_response(502), _make_response(200)]

        def fake_get(url, **kwargs):
            return responses.pop(0)

        monkeypatch.setattr(httpx, "get", fake_get)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        resp = _utils.get_with_retry("https://example.test", max_retries=3)
        assert resp.status_code == 200
        assert responses == []  # all three responses consumed

    def test_does_not_retry_on_4xx(self, monkeypatch):
        calls = {"n": 0}

        def fake_get(url, **kwargs):
            calls["n"] += 1
            return _make_response(404)

        monkeypatch.setattr(httpx, "get", fake_get)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        with pytest.raises(httpx.HTTPStatusError):
            _utils.get_with_retry("https://example.test", max_retries=3)
        # Only one call — 404 is a client error, no retry
        assert calls["n"] == 1

    def test_retries_on_network_error(self, monkeypatch):
        # First attempt raises, second returns success
        responses = [
            httpx.ConnectError("connection refused"),
            _make_response(200),
        ]

        def fake_get(url, **kwargs):
            next_item = responses.pop(0)
            if isinstance(next_item, Exception):
                raise next_item
            return next_item

        monkeypatch.setattr(httpx, "get", fake_get)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        resp = _utils.get_with_retry("https://example.test", max_retries=3)
        assert resp.status_code == 200

    def test_gives_up_after_max_retries(self, monkeypatch):
        def always_fail(url, **kwargs):
            return _make_response(503)

        monkeypatch.setattr(httpx, "get", always_fail)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        with pytest.raises(httpx.HTTPStatusError):
            _utils.get_with_retry("https://example.test", max_retries=2)


class TestPostWithRetry:
    def test_success_first_try(self, monkeypatch):
        def fake_post(url, **kwargs):
            return _make_response(200)

        monkeypatch.setattr(httpx, "post", fake_post)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        resp = _utils.post_with_retry("https://example.test", json={"x": 1})
        assert resp.status_code == 200

    def test_retries_on_5xx(self, monkeypatch):
        responses = [_make_response(500), _make_response(200)]

        def fake_post(url, **kwargs):
            return responses.pop(0)

        monkeypatch.setattr(httpx, "post", fake_post)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        resp = _utils.post_with_retry("https://example.test", max_retries=2)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# _check_arcgis_freshness — upstream-outage handling
# ---------------------------------------------------------------------------

def _arcgis_job(freshness_url: str = "https://geo.dot.gov/query", name: str = "speed_limits"):
    return SimpleNamespace(name=name, source_type="arcgis", freshness_url=freshness_url)


def _last_run(source_row_count: int | None = 100):
    return SimpleNamespace(source_row_count=source_row_count, finished_at=None)


class TestArcgisFreshness:
    """The freshness probe must not turn a transient upstream outage into a
    hard job failure. When the ArcGIS host is unreachable or 5xx-ing, the run
    should be skipped (is_fresh=False) so the loader never runs and the last
    good data stays in place — instead of fail-opening and crashing the load.
    """

    def test_5xx_outage_skips_run_instead_of_failing(self, monkeypatch):
        # geo.dot.gov returning 500s (the real incident): get_with_retry
        # exhausts retries and raises HTTPStatusError.
        monkeypatch.setattr(httpx, "get", lambda url, **kw: _make_response(503))
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        result = _utils._check_arcgis_freshness(_arcgis_job(), _last_run(100))

        assert result.is_fresh is False
        assert "unreachable" in result.reason.lower()

    def test_connection_error_skips_run(self, monkeypatch):
        def boom(url, **kw):
            raise httpx.ConnectError("connection refused")

        monkeypatch.setattr(httpx, "get", boom)
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        result = _utils._check_arcgis_freshness(_arcgis_job(), _last_run(100))

        assert result.is_fresh is False
        assert "unreachable" in result.reason.lower()

    def test_unchanged_count_still_skips(self, monkeypatch):
        monkeypatch.setattr(httpx, "get", lambda url, **kw: _make_response(200, b'{"count": 100}'))
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        result = _utils._check_arcgis_freshness(_arcgis_job(), _last_run(100))

        assert result.is_fresh is False
        assert "unchanged" in result.reason.lower()

    def test_changed_count_runs(self, monkeypatch):
        monkeypatch.setattr(httpx, "get", lambda url, **kw: _make_response(200, b'{"count": 250}'))
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        result = _utils._check_arcgis_freshness(_arcgis_job(), _last_run(100))

        assert result.is_fresh is True
        assert result.source_row_count == 250

    def test_unchanged_count_is_upstream_verified(self, monkeypatch):
        # We reached the service and it reported the same feature count — a
        # genuine upstream signal, so this skip counts as a confirmed sync.
        monkeypatch.setattr(httpx, "get", lambda url, **kw: _make_response(200, b'{"count": 100}'))
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        result = _utils._check_arcgis_freshness(_arcgis_job(), _last_run(100))

        assert result.is_fresh is False
        assert result.upstream_verified is True

    def test_outage_skip_is_not_upstream_verified(self, monkeypatch):
        # A dead / 404ing endpoint must NOT read as a confirmed sync — otherwise
        # the source pins the last good count and never trips stale (M8).
        monkeypatch.setattr(httpx, "get", lambda url, **kw: _make_response(404))
        monkeypatch.setattr(_utils.time, "sleep", lambda _: None)

        result = _utils._check_arcgis_freshness(_arcgis_job(), _last_run(100))

        assert result.is_fresh is False
        assert result.upstream_verified is False
        assert "could not verify" in result.reason.lower()


# ---------------------------------------------------------------------------
# etl_run / track_etl_run
# ---------------------------------------------------------------------------

class FakeEtlRun:
    """Stands in for the EtlRun model — captures attribute writes."""

    def __init__(self, **kwargs):
        self.id = 42  # any non-None id works
        self.source = kwargs.get("source")
        self.status = kwargs.get("status")
        self.started_at = kwargs.get("started_at")
        self.finished_at = None
        self.error_message = None
        self.rows_loaded = None


class FakeSession:
    """Minimal session that records add / commit / refresh / close calls."""

    def __init__(self):
        self.added: list = []
        self.committed = 0
        self.rolled_back = 0
        self.closed = False

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1

    def refresh(self, obj):
        # real SQLAlchemy would populate auto-generated fields; FakeEtlRun
        # pre-sets an id so there's nothing to do here.
        pass

    def close(self):
        self.closed = True


@pytest.fixture
def fake_db(monkeypatch):
    """Patch SessionLocal and EtlRun so etl_run runs without a real DB."""
    session = FakeSession()
    monkeypatch.setattr(_utils, "SessionLocal", lambda: session)
    monkeypatch.setattr(_utils, "EtlRun", FakeEtlRun)
    return session


class TestEtlRunContextManager:
    def test_success_marks_success(self, fake_db):
        with _utils.etl_run("test_source") as record:
            record.rows_loaded = 99

        assert record.status == "success"
        assert record.source == "test_source"
        assert record.rows_loaded == 99
        assert record.finished_at is not None
        assert fake_db.closed is True

    def test_exception_marks_error_and_reraises(self, fake_db):
        with pytest.raises(RuntimeError, match="boom"):
            with _utils.etl_run("failing_source"):
                raise RuntimeError("boom")

        # The most-recently-added object should be the EtlRun record
        record = fake_db.added[0]
        assert record.status == "error"
        assert record.error_message == "boom"
        assert record.finished_at is not None
        assert fake_db.closed is True

    def test_nonzero_sys_exit_marks_error_and_reraises(self, fake_db):
        """H1: sys.exit(1) (e.g. missing credentials) is a SystemExit,
        which the plain Exception handler never sees — it must still
        record an error, not strand the row in status='running'."""
        import sys

        with pytest.raises(SystemExit) as exc_info:
            with _utils.etl_run("no_creds_source"):
                sys.exit(1)

        assert exc_info.value.code == 1
        record = fake_db.added[0]
        assert record.status == "error"
        assert "exited with code 1" in record.error_message
        assert record.finished_at is not None
        assert fake_db.closed is True

    def test_zero_sys_exit_marks_success(self, fake_db):
        """sys.exit(0) is a clean exit and should record success."""
        import sys

        with pytest.raises(SystemExit):
            with _utils.etl_run("clean_exit_source"):
                sys.exit(0)

        record = fake_db.added[0]
        assert record.status == "success"
        assert record.finished_at is not None


class TestTrackEtlRunDecorator:
    def test_captures_int_return_as_rows_loaded(self, fake_db):
        @_utils.track_etl_run("decorated_source")
        def run():
            return 1234

        result = run()
        assert result == 1234
        record = fake_db.added[0]
        assert record.status == "success"
        assert record.rows_loaded == 1234

    def test_ignores_non_int_return(self, fake_db):
        @_utils.track_etl_run("decorated_source")
        def run():
            return "not an int"

        run()
        record = fake_db.added[0]
        assert record.rows_loaded is None

    def test_exception_propagates(self, fake_db):
        @_utils.track_etl_run("bad_source")
        def run():
            raise ValueError("nope")

        with pytest.raises(ValueError, match="nope"):
            run()
        record = fake_db.added[0]
        assert record.status == "error"
        assert record.error_message == "nope"


# ---------------------------------------------------------------------------
# Federal freshness allowlist (M-B6): fars + tract_density must be skippable
# ---------------------------------------------------------------------------

class TestFederalFreshnessAllowlist:
    def _fars_job(self):
        from etl.orchestrator import Job
        return Job(
            name="fars", module="etl.nhtsa_fars", source_type="federal",
            freshness_table="fars_county_year",
        )

    def test_fars_and_tract_density_are_allowlisted(self):
        assert "fars_county_year" in _utils._ALLOWED_FRESHNESS_TABLES
        assert "tract_density_county_year" in _utils._ALLOWED_FRESHNESS_TABLES

    def test_fars_skips_when_row_count_unchanged(self):
        # Unchanged count must yield is_fresh=False (skip). Before the allowlist
        # fix this returned is_fresh=True ("unknown freshness_table") so the job
        # fully reloaded every pipeline run.
        db = SimpleNamespace(execute=lambda *a, **k: SimpleNamespace(scalar=lambda: 1383))
        last_run = SimpleNamespace(source_row_count=1383)
        res = _utils._check_federal_freshness(self._fars_job(), last_run, db)
        assert res.is_fresh is False

    def test_fars_fresh_when_row_count_grew(self):
        db = SimpleNamespace(execute=lambda *a, **k: SimpleNamespace(scalar=lambda: 1400))
        last_run = SimpleNamespace(source_row_count=1383)
        res = _utils._check_federal_freshness(self._fars_job(), last_run, db)
        assert res.is_fresh is True


class TestFederalFreshnessVerification:
    """M8: the federal freshness probe compares the TARGET table's own row
    count to the last success — it never contacts upstream. An unchanged count
    therefore cannot be reported as a confirmed sync, or a silently-failing /
    year-pinned loader freezes the count and the source reads 'fresh' forever.
    An unchanged federal count must skip the reload (is_fresh=False) but be
    flagged upstream_verified=False so staleness still surfaces.
    """

    def _fars_job(self):
        from etl.orchestrator import Job
        return Job(
            name="fars", module="etl.nhtsa_fars", source_type="federal",
            freshness_table="fars_county_year",
        )

    def test_unchanged_count_is_not_upstream_verified(self):
        db = SimpleNamespace(execute=lambda *a, **k: SimpleNamespace(scalar=lambda: 1383))
        last_run = SimpleNamespace(source_row_count=1383)
        res = _utils._check_federal_freshness(self._fars_job(), last_run, db)
        assert res.is_fresh is False           # still skip the reload
        assert res.upstream_verified is False  # but do NOT claim a sync
        assert "could not verify" in res.reason.lower()

    def test_grown_count_defaults_to_verified(self):
        # A real change means the loader ran and data moved — the job runs,
        # so the flag is left at its default (True) and never masks anything.
        db = SimpleNamespace(execute=lambda *a, **k: SimpleNamespace(scalar=lambda: 1400))
        last_run = SimpleNamespace(source_row_count=1383)
        res = _utils._check_federal_freshness(self._fars_job(), last_run, db)
        assert res.is_fresh is True
        assert res.upstream_verified is True


# ---------------------------------------------------------------------------
# _check_ckan_freshness — dynamic resource resolution (Jan-2027 regression)
# ---------------------------------------------------------------------------

def _ckan_job(prefix=None, pinned="pinned-resource-id", name="crashes_ccrs"):
    return SimpleNamespace(
        name=name,
        source_type="ckan",
        freshness_resource_id=pinned,
        freshness_ckan_prefix=prefix,
    )


def _finished_run():
    from datetime import datetime
    return SimpleNamespace(source_row_count=100, finished_at=datetime(2027, 1, 10))


class TestCkanFreshnessDynamicResource:
    """When CHP publishes a new calendar year, the pinned prior-year resource
    stops changing and freshness would skip the job forever, masking a whole
    missing year as 'confirmed sync'. Jobs with a freshness_ckan_prefix must
    probe the NEWEST discovered year's resource instead of the pinned one."""

    def test_probes_newest_discovered_resource(self, monkeypatch):
        probed = {}

        def fake_get(url, params=None, **kw):
            probed["id"] = params["id"]
            return _make_response(
                200, b'{"result": {"last_modified": "2027-06-01T00:00:00"}}'
            )

        monkeypatch.setattr(httpx, "get", fake_get)
        monkeypatch.setattr(
            _utils, "discover_resource_ids",
            lambda prefix: {2026: "crashes-2026-id", 2027: "crashes-2027-id"},
        )

        result = _utils._check_ckan_freshness(_ckan_job(prefix="Crashes"), _finished_run())

        assert probed["id"] == "crashes-2027-id"
        assert result.is_fresh is True

    def test_discovery_failure_falls_back_to_pinned(self, monkeypatch):
        probed = {}

        def fake_get(url, params=None, **kw):
            probed["id"] = params["id"]
            return _make_response(
                200, b'{"result": {"last_modified": "2027-06-01T00:00:00"}}'
            )

        monkeypatch.setattr(httpx, "get", fake_get)
        monkeypatch.setattr(_utils, "discover_resource_ids", lambda prefix: {})

        _utils._check_ckan_freshness(_ckan_job(prefix="Crashes"), _finished_run())

        assert probed["id"] == "pinned-resource-id"

    def test_no_prefix_uses_pinned(self, monkeypatch):
        probed = {}

        def fake_get(url, params=None, **kw):
            probed["id"] = params["id"]
            return _make_response(
                200, b'{"result": {"last_modified": "2027-06-01T00:00:00"}}'
            )

        monkeypatch.setattr(httpx, "get", fake_get)

        _utils._check_ckan_freshness(_ckan_job(prefix=None), _finished_run())

        assert probed["id"] == "pinned-resource-id"


# ---------------------------------------------------------------------------
# dedupe_rows — CKAN pages occasionally repeat a source row; two rows with the
# same conflict key in one INSERT ... ON CONFLICT batch make Postgres raise
# "cannot affect row a second time", failing the whole batch.
# ---------------------------------------------------------------------------

class TestDedupeRows:
    def test_last_occurrence_wins(self):
        rows = [
            {"id": 1, "v": "old"},
            {"id": 2, "v": "b"},
            {"id": 1, "v": "new"},
        ]
        out = _utils.dedupe_rows(rows, ("id",))
        assert out == [{"id": 1, "v": "new"}, {"id": 2, "v": "b"}]

    def test_composite_key(self):
        rows = [
            {"id": 1, "src": "a", "v": 1},
            {"id": 1, "src": "b", "v": 2},
            {"id": 1, "src": "a", "v": 3},
        ]
        out = _utils.dedupe_rows(rows, ("id", "src"))
        assert out == [{"id": 1, "src": "a", "v": 3}, {"id": 1, "src": "b", "v": 2}]

    def test_no_duplicates_is_identity(self):
        rows = [{"id": 1}, {"id": 2}]
        assert _utils.dedupe_rows(rows, ("id",)) == rows


# ---------------------------------------------------------------------------
# Orchestrated runs must not self-track (audit M-B8: duplicate etl_runs rows)
# ---------------------------------------------------------------------------

class TestOrchestratedTrackingSkip:
    """When etl.orchestrator.run_job spawns a module subprocess it sets
    CALSIGHT_ORCHESTRATED=1 — run_job's own etl_runs row is then the single
    source of truth, and etl_run()/track_etl_run() must not write a second
    (duplicate) row. Direct CLI runs (no flag) keep self-tracking.
    """

    def test_flag_constant_matches_env_name(self):
        assert _utils.ORCHESTRATED_ENV_FLAG == "CALSIGHT_ORCHESTRATED"

    def test_etl_run_skips_db_when_orchestrated(self, fake_db, monkeypatch):
        monkeypatch.setenv(_utils.ORCHESTRATED_ENV_FLAG, "1")

        with _utils.etl_run("hospitals") as record:
            record.rows_loaded = 7

        # Nothing persisted: no add/commit on the (patched) session.
        assert fake_db.added == []
        assert fake_db.committed == 0
        # The transient record is still usable by the caller.
        assert record.rows_loaded == 7

    def test_etl_run_exception_still_propagates_when_orchestrated(
        self, fake_db, monkeypatch
    ):
        # run_job records the failure from the subprocess exit code, so the
        # exception must escape unchanged and nothing may be written here.
        monkeypatch.setenv(_utils.ORCHESTRATED_ENV_FLAG, "1")

        with pytest.raises(RuntimeError, match="boom"):
            with _utils.etl_run("hospitals"):
                raise RuntimeError("boom")

        assert fake_db.added == []
        assert fake_db.committed == 0

    def test_track_etl_run_skips_db_when_orchestrated(self, fake_db, monkeypatch):
        monkeypatch.setenv(_utils.ORCHESTRATED_ENV_FLAG, "1")

        @_utils.track_etl_run("schools")
        def run():
            return 42

        assert run() == 42
        assert fake_db.added == []
        assert fake_db.committed == 0

    def test_direct_cli_run_still_self_tracks(self, fake_db, monkeypatch):
        monkeypatch.delenv(_utils.ORCHESTRATED_ENV_FLAG, raising=False)

        @_utils.track_etl_run("schools")
        def run():
            return 42

        run()
        assert len(fake_db.added) == 1
        assert fake_db.added[0].status == "success"
        assert fake_db.added[0].rows_loaded == 42

    def test_run_job_sets_flag_on_subprocess_env(self, monkeypatch):
        """run_job must pass CALSIGHT_ORCHESTRATED=1 to the module subprocess."""
        from etl import orchestrator

        captured: dict = {}

        def fake_subprocess_run(cmd, **kwargs):
            captured["env"] = kwargs.get("env")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        class _Sess(FakeSession):
            def expunge(self, obj):
                pass

            def query(self, *a, **k):  # zombie cleanup / row counts not exercised
                raise AssertionError("unexpected query")

            def execute(self, *a, **k):
                raise RuntimeError("no db")

        sess = _Sess()
        monkeypatch.setattr(orchestrator, "SessionLocal", lambda: sess)
        monkeypatch.setattr(orchestrator.subprocess, "run", fake_subprocess_run)
        # Skip validation suite (would need a real DB).
        monkeypatch.setattr(orchestrator, "_validate_job", lambda db, job, rb: ("skipped", None))

        job = orchestrator.Job(name="schools", module="etl.load_schools")
        record = orchestrator.run_job(job, triggered_by="test")

        assert captured["env"] is not None
        assert captured["env"][_utils.ORCHESTRATED_ENV_FLAG] == "1"
        assert record.status == "success"


# ---------------------------------------------------------------------------
# run_job records an HONEST skip status (M8): a skip only reads as a confirmed
# sync (skipped_unchanged) when upstream was actually verified; an unverifiable
# skip is recorded as skipped_unverified so /api/freshness surfaces staleness.
# ---------------------------------------------------------------------------

class TestRunJobSkipStatus:
    class _SkipSess(FakeSession):
        def expunge(self, obj):
            pass

    def _run_with_freshness(self, monkeypatch, freshness):
        from etl import orchestrator

        sess = self._SkipSess()
        monkeypatch.setattr(orchestrator, "SessionLocal", lambda: sess)
        monkeypatch.setattr(_utils, "check_source_freshness", lambda job, db: freshness)
        # A skip must never spawn the loader subprocess.
        monkeypatch.setattr(
            orchestrator.subprocess, "run",
            lambda *a, **k: (_ for _ in ()).throw(AssertionError("subprocess spawned on skip")),
        )

        job = orchestrator.Job(name="fars", module="etl.nhtsa_fars", source_type="federal")
        return orchestrator.run_job(job, triggered_by="test")

    def test_verified_unchanged_records_skipped_unchanged(self, monkeypatch):
        fr = _utils.FreshnessResult(
            False, None, 1383, "upstream reports unchanged", upstream_verified=True,
        )
        record = self._run_with_freshness(monkeypatch, fr)
        assert record.status == "skipped_unchanged"

    def test_unverified_skip_records_skipped_unverified(self, monkeypatch):
        fr = _utils.FreshnessResult(
            False, None, 1383, "could not verify upstream", upstream_verified=False,
        )
        record = self._run_with_freshness(monkeypatch, fr)
        assert record.status == "skipped_unverified"
