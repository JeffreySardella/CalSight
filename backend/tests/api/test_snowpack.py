"""Integration tests for /api/water/snowpack."""

from datetime import date

import pytest

from app.models import SnowDaily, SnowStation

pytestmark = pytest.mark.integration


@pytest.fixture()
def snow_data(db_session):
    """Two regions. North (CSL) has 3 years of March-1 history: avg 10,
    latest 15 → 150% of average. South (BSH) has a single reading (no
    usable history)."""
    db_session.add_all([
        SnowStation(station_id="CSL", name="Central Sierra Snow Lab", elevation_ft=6900, region="Central Sierra"),
        SnowStation(station_id="BSH", name="Bishop Pass", elevation_ft=11200, region="Southern Sierra"),
    ])
    db_session.flush()
    db_session.add_all([
        SnowDaily(station_id="CSL", date=date(2024, 3, 1), swe_in=5.0),
        SnowDaily(station_id="CSL", date=date(2025, 3, 1), swe_in=10.0),
        SnowDaily(station_id="CSL", date=date(2026, 3, 1), swe_in=15.0),  # latest
        # An off-cycle reading that must not pollute the March-1 average.
        SnowDaily(station_id="CSL", date=date(2026, 2, 28), swe_in=99.0),
        SnowDaily(station_id="BSH", date=date(2026, 3, 1), swe_in=30.0),
    ])
    db_session.commit()
    return db_session


def test_snowpack_region_pct_of_same_day_average(client, snow_data):
    body = client.get("/api/water/snowpack").json()
    central = next(r for r in body["regions"] if r["region"] == "Central Sierra")
    assert central["latest_date"] == "2026-03-01"
    assert central["swe_in"] == 15.0
    assert central["avg_swe_in"] == pytest.approx(10.0)  # (5+10+15)/3
    assert central["pct_of_average"] == pytest.approx(150.0)
    assert central["station_count"] == 1


def test_snowpack_region_without_history_has_no_pct(client, snow_data):
    body = client.get("/api/water/snowpack").json()
    south = next(r for r in body["regions"] if r["region"] == "Southern Sierra")
    assert south["swe_in"] == 30.0
    assert south["pct_of_average"] is None
    assert south["avg_swe_in"] is None


def test_snowpack_statewide_only_counts_stations_with_history(client, snow_data):
    body = client.get("/api/water/snowpack").json()
    # Only CSL has history: 15 / 10 = 150%. BSH (no history) is excluded.
    assert body["statewide_pct_of_average"] == pytest.approx(150.0)
    assert body["latest_date"] == "2026-03-01"


def test_snowpack_regions_sorted(client, snow_data):
    regions = [r["region"] for r in client.get("/api/water/snowpack").json()["regions"]]
    assert regions == sorted(regions)


def test_snowpack_404_without_data(client):
    assert client.get("/api/water/snowpack").status_code == 404


def test_snowpack_april1_uses_last_seasons_april_during_accumulation(
    client, snow_data, db_session
):
    # newest reading is 2026-03-01, before this year's April 1 — so the
    # apr1 figures refer to 2025-04-01 (last season's April 1).
    db_session.add_all([
        SnowDaily(station_id="CSL", date=date(2024, 4, 1), swe_in=8.0),
        SnowDaily(station_id="CSL", date=date(2025, 4, 1), swe_in=12.0),
    ])
    db_session.commit()

    body = client.get("/api/water/snowpack").json()
    assert body["apr1_date"] == "2025-04-01"
    # avg over {8, 12} = 10; 2025 reading 12 → 120%.
    assert body["statewide_apr1_pct_of_average"] == pytest.approx(120.0)
    central = next(r for r in body["regions"] if r["region"] == "Central Sierra")
    assert central["apr1_swe_in"] == pytest.approx(12.0)
    assert central["apr1_avg_swe_in"] == pytest.approx(10.0)
    assert central["apr1_pct_of_average"] == pytest.approx(120.0)
    # BSH has no April-1 history at all.
    south = next(r for r in body["regions"] if r["region"] == "Southern Sierra")
    assert south["apr1_pct_of_average"] is None


def test_snowpack_april1_in_melt_season_uses_this_years_april(client, db_session):
    # Newest reading is June — the season-defining number is THIS year's
    # April 1 vs the April-1 average, even though current SWE is ~0.
    db_session.add(
        SnowStation(station_id="CSL", name="Central Sierra Snow Lab", elevation_ft=6900, region="Central Sierra")
    )
    db_session.flush()
    db_session.add_all([
        SnowDaily(station_id="CSL", date=date(2024, 4, 1), swe_in=8.0),
        SnowDaily(station_id="CSL", date=date(2025, 4, 1), swe_in=12.0),
        SnowDaily(station_id="CSL", date=date(2026, 4, 1), swe_in=6.0),
        SnowDaily(station_id="CSL", date=date(2026, 6, 15), swe_in=0.5),  # newest
    ])
    db_session.commit()

    body = client.get("/api/water/snowpack").json()
    assert body["apr1_date"] == "2026-04-01"
    # avg over {8, 12, 6} = 8.667 (period of record incl. this year);
    # this year's 6.0 → 69.2%.
    assert body["statewide_apr1_pct_of_average"] == pytest.approx(69.2, abs=0.1)


def test_snowpack_april1_absent_without_april_history(client, snow_data):
    # The base fixture has no April-1 rows at all — apr1 fields stay null.
    body = client.get("/api/water/snowpack").json()
    assert body["apr1_date"] is None
    assert body["statewide_apr1_pct_of_average"] is None


def test_snowpack_excludes_stale_offline_stations(client, db_session):
    """A station offline for years must not contribute its last-ever
    reading to the current snowpack total."""
    db_session.add_all([
        SnowStation(station_id="CSL", name="Central Sierra Snow Lab", elevation_ft=6900, region="Central Sierra"),
        SnowStation(station_id="BLK", name="Blue Lakes", elevation_ft=8000, region="Central Sierra"),
    ])
    db_session.flush()
    db_session.add_all([
        # CSL: current, with history → 15 vs avg 10 = 150%.
        SnowDaily(station_id="CSL", date=date(2024, 3, 1), swe_in=5.0),
        SnowDaily(station_id="CSL", date=date(2025, 3, 1), swe_in=10.0),
        SnowDaily(station_id="CSL", date=date(2026, 3, 1), swe_in=15.0),
        # BLK: went offline years ago; its last reading is 2019, a huge 90".
        SnowDaily(station_id="BLK", date=date(2018, 3, 1), swe_in=80.0),
        SnowDaily(station_id="BLK", date=date(2019, 3, 1), swe_in=90.0),
    ])
    db_session.commit()

    body = client.get("/api/water/snowpack").json()
    central = next(r for r in body["regions"] if r["region"] == "Central Sierra")
    # Only CSL is current — the stale 90" BLK reading is excluded entirely.
    assert central["station_count"] == 1
    assert central["swe_in"] == 15.0
    assert central["pct_of_average"] == pytest.approx(150.0)
    assert body["latest_date"] == "2026-03-01"


def test_snowpack_region_figures_reconcile(client, db_session):
    """Within a region, swe_in must equal pct_of_average% of avg_swe_in —
    they describe one consistent station set (mean-based)."""
    db_session.add_all([
        SnowStation(station_id="CSL", name="Central Sierra Snow Lab", elevation_ft=6900, region="Central Sierra"),
        SnowStation(station_id="BLK", name="Blue Lakes", elevation_ft=8000, region="Central Sierra"),
    ])
    db_session.flush()
    db_session.add_all([
        # Two comparable stations sharing a latest date (2026-03-01).
        # CSL day-of-year avg=(8+20)/2=14, latest 20; BLK avg=(20+40)/2=30,
        # latest 40. Region mean swe=30, mean avg=22 → 136.4%. The point is
        # the three reported figures reconcile, whatever the exact values.
        SnowDaily(station_id="CSL", date=date(2025, 3, 1), swe_in=8.0),
        SnowDaily(station_id="CSL", date=date(2026, 3, 1), swe_in=20.0),
        SnowDaily(station_id="BLK", date=date(2025, 3, 1), swe_in=20.0),
        SnowDaily(station_id="BLK", date=date(2026, 3, 1), swe_in=40.0),
    ])
    db_session.commit()

    central = next(
        r for r in client.get("/api/water/snowpack").json()["regions"]
        if r["region"] == "Central Sierra"
    )
    # avg_swe_in and pct must reconcile with swe_in exactly.
    assert central["station_count"] == 2
    assert central["swe_in"] == pytest.approx(
        central["avg_swe_in"] * central["pct_of_average"] / 100, abs=0.1
    )
