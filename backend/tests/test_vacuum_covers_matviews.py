"""Every nightly-refreshed materialized view must also be VACUUM ANALYZE'd.

mv_street_aggregates was added to the nightly refresh but forgotten in
vacuum_analyze, so it accumulated CONCURRENTLY-refresh dead tuples and stale
planner stats. This guard makes that omission fail a test instead of rotting
silently on an unattended box.
"""

from app.health import REFRESHABLE_VIEWS
from etl.vacuum_analyze import _TABLES


def test_every_refreshed_view_is_vacuumed():
    vacuumed = set(_TABLES)
    missing = [v for v in REFRESHABLE_VIEWS if v not in vacuumed]
    assert not missing, (
        f"materialized views refreshed nightly but never VACUUM ANALYZE'd: {missing}"
    )
