"""A statement-timeout must surface as 503 + Retry-After, not a bare 500.

The heavy statewide aggregations (clusters, highways, distribution, yoy) bound
their queries with a statement timeout. When one fires, the raw OperationalError
used to fall through to the generic 500 handler and read as "the site is
broken". The global handler turns it into an honest, retryable 503.
"""

import asyncio
from types import SimpleNamespace

from sqlalchemy.exc import OperationalError

from app.main import operational_error_handler


def _request(path="/api/crashes/clusters"):
    return SimpleNamespace(url=SimpleNamespace(path=path))


class _FakeOrig(Exception):
    """Stands in for the psycopg2 error at exc.orig: str() is the PG message
    and it carries a pgcode, like the real thing."""

    def __init__(self, message, pgcode=None):
        super().__init__(message)
        self.pgcode = pgcode


def _op_error(*, pgcode=None, message="boom"):
    orig = _FakeOrig(message, pgcode=pgcode)
    err = OperationalError("SELECT 1", {}, orig)
    err.orig = orig
    return err


def _call(exc):
    return asyncio.run(operational_error_handler(_request(), exc))


def test_statement_timeout_pgcode_becomes_503():
    resp = _call(_op_error(pgcode="57014"))
    assert resp.status_code == 503
    assert resp.headers["Retry-After"] == "60"
    assert b"Narrow it" in resp.body


def test_statement_timeout_by_message_becomes_503():
    resp = _call(_op_error(message="canceling statement due to statement timeout"))
    assert resp.status_code == 503
    assert b"Narrow it" in resp.body


def test_generic_operational_error_is_503_but_generic_message():
    resp = _call(_op_error(pgcode="08006", message="server closed the connection"))
    assert resp.status_code == 503
    assert resp.headers["Retry-After"] == "60"
    assert b"temporarily unavailable" in resp.body
    assert b"Narrow it" not in resp.body
