"""DB-backed tests for the first-rain pipeline: daily weather upsert, the
first_rain ETL, and /api/first-rain."""

from datetime import date

import pytest

from app.models import WeatherDaily
from etl.nclimgrid_weather import upsert_daily

pytestmark = pytest.mark.integration


def test_upsert_daily_fills_one_row_from_two_variables(db_session):
    """PRCP and TAVG arrive in separate files; each must only touch its own
    column so the second upsert doesn't null out the first."""
    name_to_code = {"Los Angeles": 19}
    d = date(2026, 1, 3)

    n = upsert_daily(db_session, "PRCP", {"Los Angeles": {d: 0.5}, "Nowhere": {d: 1.0}}, name_to_code)
    assert n == 1
    upsert_daily(db_session, "TAVG", {"Los Angeles": {d: 61.0}}, name_to_code)
    # Re-upsert of PRCP with a revised value must overwrite precip only.
    upsert_daily(db_session, "PRCP", {"Los Angeles": {d: 0.75}}, name_to_code)

    rows = db_session.query(WeatherDaily).filter_by(county_code=19).all()
    assert len(rows) == 1
    assert rows[0].date == d
    assert rows[0].precip_in == 0.75
    assert rows[0].avg_temp_f == 61.0
    assert rows[0].max_temp_f is None
