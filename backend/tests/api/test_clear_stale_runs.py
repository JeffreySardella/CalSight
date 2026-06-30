"""Integration test for etl.clear_stale_runs."""

from datetime import datetime, timedelta

import pytest

from app.models import EtlRun
from etl.clear_stale_runs import clear_stale_runs

pytestmark = pytest.mark.integration


def test_clears_only_stale_running_rows(db_session):
    now = datetime.utcnow()
    db_session.add_all([
        # Zombie: 'running' for 2 days — must be cleared.
        EtlRun(source="zombie_job", status="running",
               started_at=now - timedelta(days=2)),
        # Legitimately in-flight: started 30 min ago — must be left alone.
        EtlRun(source="live_job", status="running",
               started_at=now - timedelta(minutes=30)),
    ])
    db_session.flush()

    cleared = clear_stale_runs(6.0, conn=db_session)
    assert cleared == 1

    zombie = (db_session.query(EtlRun)
              .filter_by(source="zombie_job").order_by(EtlRun.id.desc()).first())
    live = (db_session.query(EtlRun)
            .filter_by(source="live_job").order_by(EtlRun.id.desc()).first())
    db_session.refresh(zombie)
    db_session.refresh(live)
    assert zombie.status == "error"
    assert zombie.finished_at is not None
    assert live.status == "running"
