"""Regression: the scheduler must survive its own startup path.

`python -m etl.pipeline` crash-looped in production for weeks (257 restarts,
2026-07 incident) because the schedule-summary log accessed
`job.next_run_time` on jobs that were still pending — APScheduler only sets
that attribute once the scheduler starts, so attribute access raised
AttributeError before start() was ever reached. CI stayed green the whole
time because nothing exercised scheduler construction. These tests run the
exact code path the container runs at boot (minus the blocking start()).
"""

import etl.pipeline as pipeline


def test_build_scheduler_registers_all_jobs_without_raising():
    scheduler = pipeline.build_scheduler()
    ids = {job.id for job in scheduler.get_jobs()}
    assert ids == {"daily_crashes", "weekly_full", "maintenance", "backup"}
    assert not scheduler.running


def test_build_scheduler_no_backup_skips_backup_job():
    scheduler = pipeline.build_scheduler(no_backup=True)
    ids = {job.id for job in scheduler.get_jobs()}
    assert ids == {"daily_crashes", "weekly_full", "maintenance"}


def test_schedule_crons_parse_and_match_registered_jobs():
    # Every configured schedule (except backup, which has no jobs entry)
    # must correspond to a registered scheduler job.
    scheduler = pipeline.build_scheduler()
    for name in pipeline.SCHEDULES:
        assert scheduler.get_job(name) is not None, f"schedule {name} not registered"


def test_weekly_runs_sunday_and_daily_skips_sunday():
    """APScheduler's numeric day_of_week is 0=Monday (standard crontab says
    0=Sunday), so the old numeric fields ran the weekly on MONDAYS and
    skipped the daily every Monday (caught live 2026-07-13). Day names are
    unambiguous — pin the actual fire days."""
    from datetime import datetime, timezone

    scheduler = pipeline.build_scheduler()
    weekly = scheduler.get_job("weekly_full").trigger
    daily = scheduler.get_job("daily_crashes").trigger

    # Sunday 2026-07-19: weekly fires at 09:00, daily does NOT fire.
    after_sat = datetime(2026, 7, 18, 23, 0, tzinfo=timezone.utc)
    assert weekly.get_next_fire_time(None, after_sat) == datetime(
        2026, 7, 19, 9, 0, tzinfo=timezone.utc
    )
    next_daily = daily.get_next_fire_time(None, after_sat)
    assert next_daily == datetime(2026, 7, 20, 11, 0, tzinfo=timezone.utc)  # Monday


def test_init_sentry_never_raises(monkeypatch):
    import sys

    # Monitoring must not stop the scheduler: no DSN → early return; a
    # broken settings import → warning, not a crash.
    pipeline._init_sentry()

    monkeypatch.setitem(sys.modules, "app.settings", None)
    pipeline._init_sentry()  # import failure path — must be swallowed
