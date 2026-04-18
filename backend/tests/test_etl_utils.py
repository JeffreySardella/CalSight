"""Tests for the shared ETL utilities.

Covers:
  - safe_int / safe_float: pure-function coercion edge cases.
  - get_with_retry / post_with_retry: HTTP retry semantics with a mock
    httpx.get/post via monkeypatch, avoiding real network calls.
  - etl_run / track_etl_run: context manager and decorator variants,
    verifying status transitions with a mocked EtlRun + session.
"""

from __future__ import annotations

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
