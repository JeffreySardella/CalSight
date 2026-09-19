"""NOAA Storm Events loader — San Joaquin Valley fog and Sierra winter events.

NCEI publishes one gzipped CSV per year of every US storm event since 1950:
https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
Filenames carry a compile date (`..._d2024_c20260728.csv.gz`) that changes
whenever NOAA reissues a year, so the loader reads the directory index and
resolves the current file for each year rather than guessing a name.

WHY THE ZONE MAP EXISTS
-----------------------
Every California Dense Fog and winter-type row in this dataset is keyed to an
**NWS forecast zone** (`CZ_TYPE = 'Z'`), never to a county — measured, not
assumed: across 2001-2025 not one Dense Fog / Winter Storm / Winter Weather /
Heavy Snow / Blizzard / Ice Storm row for California is county-keyed. `CZ_FIPS`
on those rows is a zone number (307 = "FRESNO - CLOVIS"), not a county FIPS,
and nothing shipped alongside the CSVs decomposes zones into counties.

So ZONE_COUNTIES below hand-maps the zones that actually carry these events for
the eight San Joaquin Valley counties and the Sierra counties around them.
Anything else in the CSV — other states, other event types, unmapped zones — is
dropped. This is deliberately not a statewide storm-events feature; making it
one means ingesting NWS's full zone-county correlation file.

Sources for the map, in order of authority:
  1. NWS Zone-County Correlation File `bp18mr25.dbx`
     (https://www.weather.gov/source/gis/Shapefiles/County/bp18mr25.dbx).
     Transcribed verbatim, row for row: CAZ016-019, CAZ066-073, CAZ300-337,
     CAZ519-520. "Verbatim" means every county the file lists for a zone,
     including ones outside the valley — CAZ018 reaches Sacramento and Solano,
     CAZ068 reaches Butte, Shasta and Tehama.
     NOT transcribed, deliberately: CAZ338-339 (Kern's Mojave Desert, outside
     both the valley and the Sierra), CAZ001-015, CAZ038-065, CAZ074-115 and
     CAZ340-570 (coast, southern California, deserts, the Bay Area). Those
     zones do carry fog and winter events; they are out of this story's scope
     and the per-year unmapped-zone warning in `run()` names them every time,
     so the omission stays visible instead of silent.
  2. For retired zone numbers (the Hanford WFO renumbered twice inside our
     window) the correlation file has nothing, so those are hand-read from the
     zone NAME in the data itself against county geography. They are marked
     `# hand-read` below, and they only apply to rows whose WFO is HNX — see
     RETIRED_ZONE_WFO.

A zone can straddle a county line, so an event is attached to EVERY county its
zone touches. That is the whole reason `storm_events` is unique on
(source_event_id, county_code) and not on source_event_id alone: one NOAA event
legitimately becomes several rows. It also means "a fog day in Kings County"
derived from a zone event is an approximation, never a per-county ground truth
— the story copy has to say so.

Upsert-only, like its siblings: an event NOAA *retracts* in a reissue is never
deleted from `storm_events`, only events it revises are corrected. Reissues add
and amend far more often than they withdraw, so a full reload (`--start 2001`)
is the remedy if a retraction ever matters.

Usage:
    python -m etl.load_storm_events                  # trailing 2 years
    python -m etl.load_storm_events --start 2001     # full reload
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import logging
import re
from collections import Counter
from datetime import date
from typing import Iterable, Iterator, NamedTuple

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import StormEvent
from etl._utils import dedupe_rows, get_with_retry, safe_int, track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

BASE_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
FILE_RE = re.compile(r"StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz")
FIRST_YEAR = 2001          # crash record starts here; earlier years are useless to us
DEFAULT_YEARS_BACK = 2     # NOAA revises recent years in place — re-fetch them
BATCH = 500

# The fog event type the tule-fog story is built on, kept separate because the
# /api/fog-days aggregate counts only these.
FOG_EVENT_TYPE = "Dense Fog"
WINTER_EVENT_TYPES = (
    "Winter Storm",
    "Winter Weather",
    "Heavy Snow",
    "Blizzard",
    "Ice Storm",
)
EVENT_TYPES = frozenset((FOG_EVENT_TYPE, *WINTER_EVENT_TYPES))

# County codes (app/seed_counties.py): the eight San Joaquin Valley counties,
# the Sierra counties whose zones carry the winter half of the story, and the
# Sacramento Valley counties those zones reach into (a verbatim transcription
# of a zone takes every county the correlation file lists for it).
_ALPINE, _AMADOR, _BUTTE, _CALAVERAS, _COLUSA = 2, 3, 4, 5, 6
_EL_DORADO, _FRESNO, _GLENN, _INYO, _KERN = 9, 10, 11, 14, 15
_KINGS, _LASSEN, _MADERA, _MARIPOSA, _MERCED = 16, 18, 20, 22, 24
_MODOC, _MONO, _NEVADA, _PLACER, _PLUMAS = 25, 26, 29, 31, 32
_SACRAMENTO, _SAN_JOAQUIN, _SHASTA, _SIERRA = 34, 39, 45, 46
_SOLANO, _STANISLAUS, _SUTTER, _TEHAMA = 48, 50, 51, 52
_TULARE, _TUOLUMNE, _YOLO, _YUBA = 54, 55, 57, 58


class Zone(NamedTuple):
    name: str                    # canonical zone name (the CSV's CZ_NAME drifts)
    counties: tuple[int, ...]    # every county the zone touches


# Zone id -> (name, counties). Retired and current numbers never collide: none
# of CAZ089-099 or CAZ180-199 is in use today (checked against bp18mr25.dbx).
ZONE_COUNTIES: dict[int, Zone] = {
    # --- Sacramento WFO, stable numbering (northern San Joaquin Valley + Sierra) ---
    16: Zone("Central Sacramento Valley",
             (_BUTTE, _COLUSA, _GLENN, _NEVADA, _SUTTER, _YUBA)),
    17: Zone("Southern Sacramento Valley",
             (_AMADOR, _EL_DORADO, _PLACER, _SACRAMENTO, _SOLANO, _SUTTER, _YOLO)),
    18: Zone("Carquinez Strait and Delta", (_SACRAMENTO, _SAN_JOAQUIN, _SOLANO)),
    19: Zone("Northern San Joaquin Valley",
             (_AMADOR, _CALAVERAS, _SAN_JOAQUIN, _STANISLAUS, _TUOLUMNE)),
    66: Zone("Northeast Foothills/Sacramento Valley", (_BUTTE, _SHASTA, _TEHAMA)),
    67: Zone("Motherlode",
             (_AMADOR, _CALAVERAS, _EL_DORADO, _NEVADA, _PLACER, _TUOLUMNE, _YUBA)),
    68: Zone("Western Plumas County/Lassen Park",
             (_BUTTE, _LASSEN, _PLUMAS, _SHASTA, _TEHAMA)),
    69: Zone("West Slope Northern Sierra Nevada",
             (_ALPINE, _AMADOR, _CALAVERAS, _EL_DORADO, _NEVADA, _PLACER, _SIERRA,
              _TUOLUMNE, _YUBA)),
    70: Zone("Surprise Valley California", (_MODOC,)),
    71: Zone("Lassen-Eastern Plumas-Eastern Sierra Counties",
             (_LASSEN, _PLUMAS, _SIERRA)),
    72: Zone("Greater Lake Tahoe Area", (_ALPINE, _EL_DORADO, _NEVADA, _PLACER)),
    73: Zone("Mono", (_MONO,)),

    # --- Las Vegas WFO, stable numbering (eastern Sierra) ---
    519: Zone("Eastern Sierra Slopes of Inyo County", (_INYO,)),
    520: Zone("Owens Valley", (_INYO,)),

    # --- Hanford WFO, era A (through ~2019). Retired numbering; hand-read from
    #     the zone names, which describe valley quadrants and mountain blocks. ---
    89: Zone("West Central San Joaquin Valley",  # hand-read
             (_MERCED, _MADERA, _FRESNO)),
    90: Zone("East Central San Joaquin Valley",  # hand-read
             (_FRESNO, _MADERA, _MERCED)),
    91: Zone("Southwest San Joaquin Valley", (_KINGS, _KERN)),  # hand-read
    92: Zone("Southeast San Joaquin Valley", (_TULARE, _KERN)),  # hand-read
    93: Zone("South Sierra Foothills",  # hand-read
             (_FRESNO, _MADERA, _MARIPOSA, _TULARE)),
    94: Zone("Tulare County Foothills", (_TULARE,)),  # hand-read
    95: Zone("Kern County Mountains", (_KERN,)),  # hand-read
    96: Zone("South Sierra Mountains",  # hand-read
             (_FRESNO, _MADERA, _MARIPOSA, _TULARE, _TUOLUMNE)),
    97: Zone("Tulare County Mountains", (_TULARE,)),  # hand-read
    98: Zone("Indian Wells Valley", (_KERN,)),  # hand-read
    99: Zone("Southeast Kern County Desert", (_KERN,)),  # hand-read

    # --- Hanford WFO, era B (~2019-2021). Also retired; hand-read. ---
    180: Zone("San Joaquin Confluence", (_FRESNO, _MERCED)),  # hand-read
    181: Zone("Merced and Madera", (_MERCED, _MADERA)),  # hand-read
    182: Zone("Western San Joaquin Valley", (_FRESNO, _KINGS)),  # hand-read
    183: Zone("Foggy Bottom", (_FRESNO, _KINGS, _TULARE)),  # hand-read
    184: Zone("Fresno", (_FRESNO,)),  # hand-read
    185: Zone("Tulare County", (_TULARE,)),  # hand-read
    186: Zone("Southern Kings County", (_KINGS,)),  # hand-read
    187: Zone("Western San Joaquin Valley in Kern County", (_KERN,)),  # hand-read
    188: Zone("Eastern San Joaquin Valley in Kern County", (_KERN,)),  # hand-read
    189: Zone("Bakersfield", (_KERN,)),  # hand-read
    190: Zone("Central Sierra Foothills", (_FRESNO, _MADERA, _MARIPOSA)),  # hand-read
    191: Zone("Southern Sierra Foothills", (_TULARE, _KERN)),  # hand-read
    192: Zone("Central Sierra",  # hand-read
              (_FRESNO, _MADERA, _MARIPOSA, _TUOLUMNE)),
    193: Zone("North Kings River", (_FRESNO,)),  # hand-read
    194: Zone("Sequoia Kings", (_FRESNO, _TULARE)),  # hand-read
    195: Zone("Lake Isabella", (_KERN,)),  # hand-read
    196: Zone("Tehachapi Area", (_KERN,)),  # hand-read
    197: Zone("Fort Tejon", (_KERN,)),  # hand-read
    198: Zone("Indian Wells Valley", (_KERN,)),  # hand-read
    199: Zone("Kern County Desert", (_KERN,)),  # hand-read

    # --- Hanford WFO, current numbering (2021-). Verbatim from bp18mr25.dbx. ---
    300: Zone("West Side Mountains north of 198", (_FRESNO, _MERCED)),
    301: Zone("Los Banos - Dos Palos", (_FRESNO, _MERCED)),
    302: Zone("Merced - Madera - Mendota", (_FRESNO, _MADERA, _MERCED)),
    303: Zone("Planada - Le Grand - Snelling", (_MADERA, _MARIPOSA, _MERCED)),
    304: Zone("Coalinga - Avenal", (_FRESNO, _KINGS)),
    305: Zone("West Side of Fresno and Kings Counties", (_FRESNO, _KINGS)),
    306: Zone("Caruthers - San Joaquin - Selma", (_FRESNO, _TULARE)),
    307: Zone("Fresno-Clovis", (_FRESNO,)),
    308: Zone("West Side Mountains South of 198", (_FRESNO, _KERN, _KINGS)),
    309: Zone("Buttonwillow - Lost Hills - I5", (_KERN, _KINGS)),
    310: Zone("Delano-Wasco-Shafter", (_KERN, _KINGS, _TULARE)),
    311: Zone("Hanford - Corcoran - Lemoore", (_FRESNO, _KINGS, _TULARE)),
    312: Zone("Visalia - Porterville - Reedley", (_FRESNO, _TULARE)),
    313: Zone("Buena Vista", (_KERN,)),
    314: Zone("Bakersfield", (_KERN,)),
    315: Zone("Southeast San Joaquin Valley", (_KERN, _TULARE)),
    316: Zone("South End San Joaquin Valley", (_KERN,)),
    317: Zone("Mariposa Madera Foothills", (_MADERA, _MARIPOSA, _MERCED)),
    318: Zone("Mariposa-Madera Lower Sierra", (_MADERA, _MARIPOSA)),
    319: Zone("Fresno-Tulare Foothills", (_FRESNO, _TULARE)),
    320: Zone("Fresno-Tulare Lower Sierra", (_FRESNO, _TULARE)),
    321: Zone("South End Sierra Foothills", (_KERN, _TULARE)),
    322: Zone("South End of the Lower Sierra", (_KERN, _TULARE)),
    323: Zone("Yosemite NP outside of the valley", (_MADERA, _MARIPOSA, _TUOLUMNE)),
    324: Zone("Yosemite Valley", (_MARIPOSA,)),
    325: Zone("San Joaquin River Canyon", (_FRESNO, _MADERA)),
    326: Zone("Upper San Joaquin River", (_FRESNO, _MADERA)),
    327: Zone("Kaiser to Rodgers Ridge", (_FRESNO,)),
    328: Zone("Kings Canyon NP", (_FRESNO, _TULARE)),
    329: Zone("Grant Grove Area", (_FRESNO, _TULARE)),
    330: Zone("Sequoia NP", (_TULARE,)),
    331: Zone("South End of the Upper Sierra", (_KERN, _TULARE)),
    332: Zone("Kern River Valley", (_KERN, _TULARE)),
    333: Zone("Piute Walker Basin", (_KERN,)),
    334: Zone("Tehachapi", (_KERN,)),
    335: Zone("Grapevine", (_KERN,)),
    336: Zone("Frazier Mountain Communities", (_KERN,)),
    337: Zone("Indian Wells Valley", (_KERN,)),
}

# Every county any mapped zone touches. /api/fog-days imports this to bound its
# crash queries to the counties the fog/winter record can speak about at all.
MAPPED_COUNTY_CODES: frozenset[int] = frozenset(
    code for z in ZONE_COUNTIES.values() for code in z.counties
)

# Zone ids below this are RETIRED Hanford-WFO numbers, hand-read rather than
# transcribed. The "nobody reuses them" claim cannot be checked from inside this
# repo, so don't rely on it: a retired number only resolves on a row the Hanford
# office issued. Any other office reusing 089-099 or 180-199 falls through to
# the unmapped counter instead of being filed under Fresno.
RETIRED_ZONE_WFO = "HNX"
# Sub-300 zone ids that are current, transcribed from the correlation file, and
# therefore exempt from the WFO gate. Every OTHER sub-300 id in the map is a
# retired Hanford number.
TRANSCRIBED_SUB_300_ZONES = frozenset({16, 17, 18, 19, 66, 67, 68, 69, 70, 71, 72, 73})
RETIRED_ZONES: frozenset[int] = frozenset(
    z for z in ZONE_COUNTIES if z < 300 and z not in TRANSCRIBED_SUB_300_ZONES
)


def _ym_day_to_date(yearmonth: str, day: str) -> date | None:
    """`('202401', '14')` -> date(2024, 1, 14).

    BEGIN_YEARMONTH/BEGIN_DAY are used instead of BEGIN_DATE_TIME because they
    are unambiguous integers; BEGIN_DATE_TIME is `14-JAN-24`, a two-digit year
    with a locale-ish month abbreviation.
    """
    ym, d = safe_int(yearmonth), safe_int(day)
    if not ym or not d:
        return None
    try:
        return date(ym // 100, ym % 100, d)
    except ValueError:
        return None


def lookup_zone(zone_id: int | None, wfo: str | None) -> Zone | None:
    """The mapped zone for a CSV row, or None if this row's zone isn't mapped.

    Retired Hanford numbers only resolve on Hanford rows (see RETIRED_ZONE_WFO).
    """
    if zone_id is None:
        return None
    zone = ZONE_COUNTIES.get(zone_id)
    if zone is None:
        return None
    if zone_id in RETIRED_ZONES and (wfo or "").strip() != RETIRED_ZONE_WFO:
        return None
    return zone


def rows_from_csv(
    text: str, unmapped: Counter[tuple[int, str]] | None = None
) -> Iterator[dict]:
    """CA + mapped-zone + fog/winter rows, expanded to one row per county.

    This is the whole filter, and the only part worth unit-testing: everything
    else in the file is dropped here.

    A hand-built zone map is only auditable if what it misses is counted, so
    every CA fog/winter row whose zone does NOT resolve is tallied into
    `unmapped` as (zone id, CZ_NAME) — `run()` logs that per year at warning
    level. Rows dropped for state, key type or event type are not tallied:
    those are the intended filter, not a coverage gap.
    """
    for r in csv.DictReader(io.StringIO(text)):
        if r.get("STATE") != "CALIFORNIA" or r.get("CZ_TYPE") != "Z":
            continue
        if r.get("EVENT_TYPE") not in EVENT_TYPES:
            continue
        zone_id = safe_int(r.get("CZ_FIPS"))
        zone = lookup_zone(zone_id, r.get("WFO"))
        if zone is None:
            if unmapped is not None:
                unmapped[(zone_id if zone_id is not None else -1,
                          (r.get("CZ_NAME") or "").strip())] += 1
            continue
        begin = _ym_day_to_date(r.get("BEGIN_YEARMONTH"), r.get("BEGIN_DAY"))
        if begin is None:
            continue  # a row we cannot date is a row we cannot use
        event_id = safe_int(r.get("EVENT_ID"))
        if event_id is None:
            continue
        end = _ym_day_to_date(r.get("END_YEARMONTH"), r.get("END_DAY")) or begin
        if end < begin:
            end = begin
        for county_code in zone.counties:
            yield {
                "source_event_id": event_id,
                "county_code": county_code,
                "event_type": r["EVENT_TYPE"],
                "begin_date": begin,
                "end_date": end,
                "zone_id": zone_id,
                "zone_name": zone.name,
                "deaths_direct": safe_int(r.get("DEATHS_DIRECT")) or 0,
                "injuries_direct": safe_int(r.get("INJURIES_DIRECT")) or 0,
                "source": (r.get("SOURCE") or "").strip()[:60] or None,
            }


def parse_index(html: str) -> dict[int, str]:
    """year -> newest details filename, from the NCEI directory index HTML.

    NOAA reissues years under a new compile-date suffix (`_c20260728`), so the
    compile date decides, not listing order: "last match wins" silently picked
    a stale revision if the index ever came back descending.
    """
    newest: dict[int, tuple[str, str]] = {}  # year -> (compile date, filename)
    for match in FILE_RE.finditer(html):
        year, compiled = int(match.group(1)), match.group(2)
        if year not in newest or compiled > newest[year][0]:
            newest[year] = (compiled, match.group(0))
    return {year: filename for year, (_, filename) in newest.items()}


def list_year_files() -> dict[int, str]:
    return parse_index(get_with_retry(BASE_URL, timeout=120).text)


def fetch_year(filename: str) -> str:
    """Download and gunzip one yearly details file (~13 MB gz)."""
    resp = get_with_retry(BASE_URL + filename, timeout=900)
    return gzip.decompress(resp.content).decode("utf-8", "replace")


def upsert(db, rows: Iterable[dict]) -> int:
    """Idempotent upsert on (source_event_id, county_code). Returns rows written.

    Counts what Postgres actually inserted or updated, not what was attempted:
    a no-op re-run must be distinguishable from a real load in
    `EtlRun.rows_loaded`, because that number is the only signal a silently
    broken upstream leaves behind.
    """
    rows = dedupe_rows(list(rows), ("source_event_id", "county_code"))
    written = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        stmt = pg_insert(StormEvent).values(chunk)
        result = db.execute(stmt.on_conflict_do_update(
            constraint="uq_storm_events_event_county",
            set_={k: getattr(stmt.excluded, k) for k in (
                "event_type", "begin_date", "end_date", "zone_id", "zone_name",
                "deaths_direct", "injuries_direct", "source",
            )},
        ))
        written += result.rowcount if result.rowcount is not None and result.rowcount >= 0 else len(chunk)
    db.commit()
    return written


def _log_unmapped(year: int, unmapped: Counter[tuple[int, str]]) -> None:
    """Report the CA fog/winter rows this year whose zone isn't in the map.

    Warning level on purpose: a hand-built map's blind spot has to show up in
    the run log, or a genuine omission is indistinguishable from the scope the
    map deliberately leaves out.
    """
    if not unmapped:
        return
    top = ", ".join(
        f"CAZ{zone_id:03d} {name or '?'} x{count}" if zone_id >= 0 else f"unparseable zone id x{count}"
        for (zone_id, name), count in unmapped.most_common(8)
    )
    logger.warning(
        "storm_events %d: %d rows in %d unmapped zones dropped (top: %s)",
        year, sum(unmapped.values()), len(unmapped), top,
    )


@track_etl_run("storm_events")
def run(start: int | None = None, end: int | None = None) -> int:
    files = list_year_files()
    if not files:
        # A 200 with an unrecognisable index (NCEI reorganises, or serves a
        # landing page) would otherwise skip every year and record success with
        # zero rows — the "fossilized source" failure, invisible to the
        # max_drop_pct guard because an upsert-only loader never drops rows.
        raise RuntimeError(f"NCEI index at {BASE_URL} listed no StormEvents_details files")
    newest = max(files)
    end = min(end or newest, newest)
    start = max(start or (end - DEFAULT_YEARS_BACK + 1), FIRST_YEAR)

    db = SessionLocal()
    total = 0
    missing: list[int] = []
    try:
        for year in range(start, end + 1):
            filename = files.get(year)
            if filename is None:
                logger.warning("storm_events: no file listed for %d, skipping", year)
                missing.append(year)
                continue
            unmapped: Counter[tuple[int, str]] = Counter()
            rows = list(rows_from_csv(fetch_year(filename), unmapped))
            written = upsert(db, rows)
            total += written
            logger.info("storm_events: %d -> %d county-rows from %s", year, written, filename)
            _log_unmapped(year, unmapped)
    finally:
        db.close()
    if total == 0:
        raise RuntimeError(
            f"storm_events wrote no rows for {start}-{end} "
            f"({len(missing)} year(s) had no file listed) — refusing to record a successful no-op"
        )
    logger.info(
        "storm_events: %d rows across %d-%d, %d zones mapped onto %d counties",
        total, start, end, len(ZONE_COUNTIES), len(MAPPED_COUNTY_CODES),
    )
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load NOAA Storm Events (CA fog + winter)")
    parser.add_argument("--start", type=int, help=f"first year (default: {DEFAULT_YEARS_BACK} years back)")
    parser.add_argument("--end", type=int, help="last year (default: newest listed)")
    args = parser.parse_args()
    run(start=args.start, end=args.end)
