"""etl.migrate — advisory-lock discipline (#292).

pg_try_advisory_lock is session-scoped: the lock lives and dies with the
connection that took it. apply_migrations must acquire the lock, run
Alembic, and release the lock all on the SAME connection — acquiring in
one connection and "releasing" in another provides zero protection.
"""

from __future__ import annotations

from types import SimpleNamespace

from etl import migrate


class _FakeConn:
    """Connection stub recording every SQL statement it executes."""

    def __init__(self, owner, lock_acquired=True):
        self._owner = owner
        self._lock_acquired = lock_acquired
        self.statements: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, clause):
        sql = str(clause)
        self.statements.append(sql)
        self._owner.executions.append((self, sql))
        if "pg_try_advisory_lock" in sql:
            return SimpleNamespace(scalar=lambda: self._lock_acquired)
        return SimpleNamespace(scalar=lambda: None, fetchone=lambda: None)


class _FakeEngine:
    """Every connect() hands out a NEW connection, like a real pool."""

    def __init__(self, lock_acquired=True):
        self.connections: list[_FakeConn] = []
        self.executions: list[tuple[_FakeConn, str]] = []
        self._lock_acquired = lock_acquired

    def connect(self):
        conn = _FakeConn(self, lock_acquired=self._lock_acquired)
        self.connections.append(conn)
        return conn


def test_lock_acquired_and_released_on_same_connection(monkeypatch):
    engine = _FakeEngine()
    monkeypatch.setattr(migrate, "etl_engine", engine)
    monkeypatch.setattr(
        migrate.subprocess, "run",
        lambda *a, **k: SimpleNamespace(returncode=0, stdout="", stderr=""),
    )

    assert migrate.apply_migrations() is True

    lock_conns = {c for c, sql in engine.executions if "pg_try_advisory_lock" in sql}
    unlock_conns = {c for c, sql in engine.executions if "pg_advisory_unlock" in sql}
    assert len(lock_conns) == 1
    assert lock_conns == unlock_conns, (
        "advisory lock must be released on the same connection that acquired it"
    )

    # And within that connection: acquire before alembic-triggering release.
    conn = lock_conns.pop()
    lock_idx = next(i for i, s in enumerate(conn.statements) if "pg_try_advisory_lock" in s)
    unlock_idx = next(i for i, s in enumerate(conn.statements) if "pg_advisory_unlock" in s)
    assert lock_idx < unlock_idx


def test_lock_released_even_when_alembic_fails(monkeypatch):
    engine = _FakeEngine()
    monkeypatch.setattr(migrate, "etl_engine", engine)
    monkeypatch.setattr(
        migrate.subprocess, "run",
        lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="boom"),
    )

    assert migrate.apply_migrations() is False

    lock_conns = {c for c, sql in engine.executions if "pg_try_advisory_lock" in sql}
    unlock_conns = {c for c, sql in engine.executions if "pg_advisory_unlock" in sql}
    assert lock_conns == unlock_conns and len(unlock_conns) == 1


def test_concurrent_holder_skips_without_running_alembic(monkeypatch):
    engine = _FakeEngine(lock_acquired=False)
    monkeypatch.setattr(migrate, "etl_engine", engine)

    called = []
    monkeypatch.setattr(
        migrate.subprocess, "run",
        lambda *a, **k: called.append(1) or SimpleNamespace(returncode=0, stdout="", stderr=""),
    )

    # Not a failure — another process is migrating.
    assert migrate.apply_migrations() is True
    assert called == []
