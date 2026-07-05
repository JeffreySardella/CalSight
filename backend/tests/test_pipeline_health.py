from datetime import datetime, timedelta, timezone

from app.routers.pipeline_health import _age_hours


def test_age_hours_none_when_ts_missing():
    assert _age_hours(datetime(2026, 7, 4, 12, 0, 0), None) is None


def test_age_hours_naive_timestamp():
    now = datetime(2026, 7, 4, 12, 0, 0)
    assert _age_hours(now, now - timedelta(hours=3)) == 3.0


def test_age_hours_aware_timestamp_does_not_raise():
    # Postgres timestamptz (e.g. pg_stat_user_tables.last_analyze) comes back
    # tz-aware; subtracting it from the naive `now` used to raise → matview age
    # was always null (M-B4). It must normalize and compute a real value.
    now = datetime(2026, 7, 4, 12, 0, 0)  # naive UTC
    aware_ts = datetime(2026, 7, 4, 6, 0, 0, tzinfo=timezone.utc)  # 6h earlier, aware
    assert _age_hours(now, aware_ts) == 6.0


def test_age_hours_aware_non_utc_offset():
    now = datetime(2026, 7, 4, 12, 0, 0)  # naive UTC
    # 10:00 at UTC+2 == 08:00 UTC == 4h before noon UTC
    aware_ts = datetime(2026, 7, 4, 10, 0, 0, tzinfo=timezone(timedelta(hours=2)))
    assert _age_hours(now, aware_ts) == 4.0
