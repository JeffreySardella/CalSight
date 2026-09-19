"""Unit tests for the NOAA Storm Events filter and the zone -> county map.

No network, no database: everything here runs against a CSV fixture string
shaped exactly like NCEI's StormEvents_details files.
"""

from collections import Counter
from datetime import date

import pytest

from etl import load_storm_events
from etl.load_storm_events import (
    EVENT_TYPES,
    FOG_EVENT_TYPE,
    MAPPED_COUNTY_CODES,
    RETIRED_ZONES,
    TRANSCRIBED_SUB_300_ZONES,
    ZONE_COUNTIES,
    parse_index,
    rows_from_csv,
)

HEADER = (
    "BEGIN_YEARMONTH,BEGIN_DAY,BEGIN_TIME,END_YEARMONTH,END_DAY,END_TIME,"
    "EPISODE_ID,EVENT_ID,STATE,STATE_FIPS,YEAR,MONTH_NAME,EVENT_TYPE,CZ_TYPE,"
    "CZ_FIPS,CZ_NAME,WFO,BEGIN_DATE_TIME,CZ_TIMEZONE,END_DATE_TIME,"
    "INJURIES_DIRECT,INJURIES_INDIRECT,DEATHS_DIRECT,DEATHS_INDIRECT,SOURCE"
)


def _row(**over):
    base = dict(
        BEGIN_YEARMONTH="202401", BEGIN_DAY="14", BEGIN_TIME="1934",
        END_YEARMONTH="202401", END_DAY="15", END_TIME="1100",
        EPISODE_ID="1", EVENT_ID="1147721", STATE="CALIFORNIA", STATE_FIPS="6",
        YEAR="2024", MONTH_NAME="January", EVENT_TYPE="Dense Fog", CZ_TYPE="Z",
        CZ_FIPS="311", CZ_NAME="HANFORD - CORCORAN - LEMOORE", WFO="HNX",
        BEGIN_DATE_TIME="14-JAN-24 19:34:00", CZ_TIMEZONE="PST-8",
        END_DATE_TIME="15-JAN-24 11:00:00", INJURIES_DIRECT="0",
        INJURIES_INDIRECT="0", DEATHS_DIRECT="0", DEATHS_INDIRECT="0",
        SOURCE="Trained Spotter",
    )
    base.update(over)
    return ",".join(base[k] for k in HEADER.split(","))


def csv_text(*rows: str) -> str:
    return "\n".join([HEADER, *rows]) + "\n"


def test_multi_county_zone_becomes_one_row_per_county():
    """CAZ311 spans Fresno (10), Kings (16) and Tulare (54)."""
    rows = list(rows_from_csv(csv_text(_row())))
    assert sorted(r["county_code"] for r in rows) == [10, 16, 54]
    assert {r["source_event_id"] for r in rows} == {1147721}
    first = rows[0]
    assert first["begin_date"] == date(2024, 1, 14)
    assert first["end_date"] == date(2024, 1, 15)
    assert first["zone_id"] == 311
    # The canonical name from the map, not the shouty CZ_NAME in the file.
    assert first["zone_name"] == "Hanford - Corcoran - Lemoore"
    assert first["source"] == "Trained Spotter"
    assert (first["deaths_direct"], first["injuries_direct"]) == (0, 0)


def test_single_county_zone_and_casualties():
    rows = list(rows_from_csv(csv_text(
        _row(EVENT_ID="9", CZ_FIPS="314", CZ_NAME="BAKERSFIELD",
             EVENT_TYPE="Winter Storm", DEATHS_DIRECT="2", INJURIES_DIRECT="7"),
    )))
    assert len(rows) == 1
    assert rows[0]["county_code"] == 15  # Kern
    assert (rows[0]["deaths_direct"], rows[0]["injuries_direct"]) == (2, 7)


def test_drops_other_states_types_keys_and_unmapped_zones():
    text = csv_text(
        _row(EVENT_ID="1", STATE="OREGON"),                   # wrong state
        _row(EVENT_ID="2", EVENT_TYPE="High Wind"),           # wrong event type
        _row(EVENT_ID="3", CZ_TYPE="C", CZ_FIPS="19"),        # county-keyed row
        _row(EVENT_ID="4", CZ_FIPS="43",                      # San Diego coast:
             CZ_NAME="SAN DIEGO COUNTY COASTAL AREAS"),       # real zone, not mapped
        _row(EVENT_ID="5", CZ_FIPS="notanumber"),             # junk zone id
    )
    assert list(rows_from_csv(text)) == []


def test_drops_rows_that_cannot_be_dated_and_repairs_backwards_spans():
    dateless = list(rows_from_csv(csv_text(_row(BEGIN_YEARMONTH="", BEGIN_DAY=""))))
    assert dateless == []

    impossible = list(rows_from_csv(csv_text(_row(BEGIN_YEARMONTH="202402", BEGIN_DAY="31"))))
    assert impossible == []

    # END before BEGIN (seen on a handful of legacy rows) collapses to one day
    # rather than producing a negative span the fog-day expansion would drop.
    backwards = list(rows_from_csv(csv_text(
        _row(CZ_FIPS="307", END_YEARMONTH="202401", END_DAY="13"),
    )))
    assert backwards[0]["begin_date"] == backwards[0]["end_date"] == date(2024, 1, 14)

    # A missing END falls back to BEGIN.
    open_ended = list(rows_from_csv(csv_text(
        _row(CZ_FIPS="307", END_YEARMONTH="", END_DAY=""),
    )))
    assert open_ended[0]["end_date"] == date(2024, 1, 14)


def test_legacy_zone_numbers_still_map():
    """The Hanford WFO renumbered twice inside 2001-2025; all three eras resolve."""
    era_a = list(rows_from_csv(csv_text(
        _row(EVENT_ID="11", BEGIN_YEARMONTH="200512", BEGIN_DAY="3",
             END_YEARMONTH="200512", END_DAY="3", CZ_FIPS="92",
             CZ_NAME="SE S.J. VALLEY"),
    )))
    assert sorted(r["county_code"] for r in era_a) == [15, 54]  # Kern, Tulare

    era_b = list(rows_from_csv(csv_text(
        _row(EVENT_ID="12", BEGIN_YEARMONTH="202001", BEGIN_DAY="9",
             END_YEARMONTH="202001", END_DAY="9", CZ_FIPS="183",
             CZ_NAME="FOGGY BOTTOM"),
    )))
    assert sorted(r["county_code"] for r in era_b) == [10, 16, 54]


def test_retired_zone_numbers_only_resolve_for_the_hanford_office():
    """If another office ever reuses CAZ092, its advisory is not filed under Kern."""
    unmapped: Counter = Counter()
    other_office = list(rows_from_csv(csv_text(
        _row(EVENT_ID="13", CZ_FIPS="92", CZ_NAME="SOMEWHERE ELSE", WFO="MTR"),
    ), unmapped))
    assert other_office == []
    assert unmapped[(92, "SOMEWHERE ELSE")] == 1

    # A current zone transcribed from the correlation file is not WFO-gated:
    # CAZ072 (Greater Lake Tahoe) is issued by Reno, not Hanford.
    tahoe = list(rows_from_csv(csv_text(
        _row(EVENT_ID="14", CZ_FIPS="72", CZ_NAME="GREATER LAKE TAHOE AREA",
             EVENT_TYPE="Heavy Snow", WFO="REV"),
    )))
    assert sorted(r["county_code"] for r in tahoe) == [2, 9, 29, 31]


def test_unmapped_zones_are_counted_not_silently_dropped():
    """The map is hand-built, so what it misses has to be countable."""
    unmapped: Counter = Counter()
    rows = list(rows_from_csv(csv_text(
        _row(EVENT_ID="21", CZ_FIPS="43", CZ_NAME="SAN DIEGO COUNTY COASTAL AREAS"),
        _row(EVENT_ID="22", CZ_FIPS="43", CZ_NAME="SAN DIEGO COUNTY COASTAL AREAS"),
        _row(EVENT_ID="23", CZ_FIPS="552", CZ_NAME="ORANGE COUNTY COASTAL"),
        _row(EVENT_ID="24"),                                  # mapped, not counted
        _row(EVENT_ID="25", EVENT_TYPE="High Wind"),          # filtered out, not counted
        _row(EVENT_ID="26", STATE="OREGON"),                  # filtered out, not counted
    ), unmapped))
    assert len(rows) == 3  # only the CAZ311 row, across its three counties
    assert unmapped == Counter({
        (43, "SAN DIEGO COUNTY COASTAL AREAS"): 2,
        (552, "ORANGE COUNTY COASTAL"): 1,
    })


def test_transcribed_zones_are_exempt_from_the_wfo_gate():
    assert TRANSCRIBED_SUB_300_ZONES.isdisjoint(RETIRED_ZONES)
    assert RETIRED_ZONES == {z for z in ZONE_COUNTIES if z < 300} - TRANSCRIBED_SUB_300_ZONES
    assert all(z >= 300 or z in TRANSCRIBED_SUB_300_ZONES or z in RETIRED_ZONES
               for z in ZONE_COUNTIES)


def test_zone_map_is_internally_consistent():
    assert FOG_EVENT_TYPE in EVENT_TYPES
    assert all(1 <= code <= 58 for z in ZONE_COUNTIES.values() for code in z.counties)
    # No zone is mapped to the same county twice, and none is left empty.
    for zone_id, zone in ZONE_COUNTIES.items():
        assert zone.counties, f"CAZ{zone_id:03d} maps to no county"
        assert len(set(zone.counties)) == len(zone.counties), f"CAZ{zone_id:03d} repeats a county"
    # The eight San Joaquin Valley counties the story is about are all covered:
    # Fresno, Kern, Kings, Madera, Merced, San Joaquin, Stanislaus, Tulare.
    assert {10, 15, 16, 20, 24, 39, 50, 54} <= MAPPED_COUNTY_CODES


def test_correlation_file_zones_are_transcribed_whole():
    """Verbatim means every county the NWS file lists, not just valley ones.

    Spot-checked against bp18mr25.dbx: these three each reach outside the San
    Joaquin Valley, and truncating them to the counties the story cares about
    is the exact bug that left CAZ016/017/066/068/070 out of the first cut.
    """
    assert ZONE_COUNTIES[18].counties == (34, 39, 48)          # Sacramento, San Joaquin, Solano
    assert ZONE_COUNTIES[68].counties == (4, 18, 32, 45, 52)   # Butte, Lassen, Plumas, Shasta, Tehama
    assert ZONE_COUNTIES[70].counties == (25,)                 # Modoc
    assert TRANSCRIBED_SUB_300_ZONES <= set(ZONE_COUNTIES)


ENTRIES = [
    '<a href="StormEvents_details-ftp_v1.0_d2023_c20260323.csv.gz">x</a>',
    '<a href="StormEvents_details-ftp_v1.0_d2024_c20260323.csv.gz">x</a>',
    '<a href="StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz">x</a>',
    '<a href="StormEvents_locations-ftp_v1.0_d2024_c20260728.csv.gz">x</a>',
]


@pytest.mark.parametrize("entries", [ENTRIES, list(reversed(ENTRIES))])
def test_parse_index_keeps_the_latest_compile_date_per_year(entries):
    """The compile date decides, not listing order — a descending index used to
    silently hand back the older, stale revision of a year."""
    files = parse_index("".join(entries))
    assert files[2023] == "StormEvents_details-ftp_v1.0_d2023_c20260323.csv.gz"
    assert files[2024] == "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz"
    assert set(files) == {2023, 2024}


def test_parse_index_returns_nothing_for_an_unrecognisable_page():
    """run() turns this into a raise rather than a successful zero-row load."""
    assert parse_index("<html><body>404 Not Found</body></html>") == {}


# run() is wrapped by @track_etl_run, which writes an EtlRun row; __wrapped__ is
# the undecorated function, so these stay DB-free unit tests.
_run = load_storm_events.run.__wrapped__


def test_run_raises_when_the_index_lists_no_files(monkeypatch):
    """A 200 serving a landing page must fail, not record a zero-row success."""
    monkeypatch.setattr(load_storm_events, "list_year_files", dict)
    with pytest.raises(RuntimeError, match="listed no StormEvents_details files"):
        _run()


def test_run_raises_when_every_year_writes_nothing(monkeypatch):
    monkeypatch.setattr(
        load_storm_events, "list_year_files",
        lambda: {2024: "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz"},
    )
    monkeypatch.setattr(load_storm_events, "fetch_year", lambda _f: csv_text())
    monkeypatch.setattr(load_storm_events, "SessionLocal", lambda: _NullSession())
    with pytest.raises(RuntimeError, match="wrote no rows"):
        _run(start=2024, end=2024)


class _NullSession:
    def execute(self, *a, **k):
        raise AssertionError("no rows should reach the database")

    def commit(self):
        pass

    def close(self):
        pass
