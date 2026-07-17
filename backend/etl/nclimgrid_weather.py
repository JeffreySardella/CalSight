"""nClimGrid-Daily county weather ETL — replaces the GSOM loader.

NOAA's nClimGrid-Daily product publishes daily county-level area averages of
temperature and precipitation as plain bulk CSVs (no API token). This loader
aggregates them to the monthly county rows the `weather` table and
`/api/weather` already expect, so it is a drop-in replacement for
`etl.noaa_weather` (GSOM) — but immune to the CDO token-API stall that left
the weather table with zero 2026 rows, and gridded rather than naive
station-averaging (better for big counties like San Bernardino).

Why this replaces GSOM:
  - No API token dependency (GSOM needs NOAA_API_TOKEN; a missing/expired
    token silently stalled the source).
  - One static-file fetch per variable-month covers every US county, vs GSOM's
    thousands of paginated, rate-limited per-county requests.
  - Daily granularity is available for future work (first-rain-after-dry-spell
    crash analysis); this loader aggregates to monthly to preserve the
    existing table contract, but the daily source is one field away.

County-join landmine: nClimGrid's numeric code column is NOT FIPS — code
06001 in these files is "CT: Fairfield County", not Alameda CA. The join keys
off the state-prefixed county NAME in column 3 ("CA: Alameda County"), matched
to our County.name.

Data format (one row per county × variable × month):
  cty,<code>,<ST: County Name>,<YYYY>,<MM>,<VAR>,<day1>,<day2>,...,<dayN>
  - VAR ∈ {TAVG, TMAX, TMIN, PRCP}; temps in °C, precip in mm.
  - -999.99 marks a missing/absent day (e.g. day 31 of a 30-day month).

Source: https://www.ncei.noaa.gov/products/land-based-station/nclimgrid-daily

Usage:
    python -m etl.nclimgrid_weather                    # trailing 2 months
    python -m etl.nclimgrid_weather --start 2001-01 --end 2026-07   # backfill
"""

import argparse
import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, Weather
from etl._utils import track_etl_run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

BASE_URL = "https://www.ncei.noaa.gov/data/nclimgrid-daily/access/averages"
VARIABLES = ("tavg", "tmax", "tmin", "prcp")
MISSING_SENTINEL = -999.99
MAX_RETRIES = 3
BACKOFF_BASE = 2
REQUEST_DELAY = 0.2  # polite pause between static-file fetches
DEFAULT_MONTHS_BACK = 2  # trailing window catches the prelim -> scaled revision

# Map the CSV variable name to the weather-table column + aggregation.
_TEMP_COLUMN = {"TAVG": "avg_temp_f", "TMAX": "max_temp_f", "TMIN": "min_temp_f"}


@dataclass
class ParsedRow:
    state: str
    county_name: str
    year: int
    month: int
    variable: str
    daily: list[float]  # present daily values only (sentinel dropped)


def celsius_to_fahrenheit(c: float) -> float:
    return round(c * 9 / 5 + 32, 2)


def mm_to_inches(mm: float) -> float:
    return round(mm / 25.4, 2)


def _is_present(value: float) -> bool:
    """A daily value is present unless it is the -999.99 missing sentinel."""
    return value > -999.0


def parse_row(line: str) -> ParsedRow | None:
    """Parse one nClimGrid county-average CSV row, or None if not a data row.

    The county NAME (not the numeric code) is the join key — the code is a
    legacy NCDC state ordering, not FIPS.
    """
    fields = line.strip().split(",")
    if len(fields) < 7 or fields[0] != "cty":
        return None

    label = fields[2].strip()  # "CA: Alameda County"
    if ":" not in label:
        return None
    state, _, name = label.partition(":")
    county_name = name.strip().removesuffix(" County").strip()

    try:
        year = int(fields[3])
        month = int(fields[4])
    except ValueError:
        return None
    variable = fields[5].strip()

    daily = []
    for raw in fields[6:]:
        raw = raw.strip()
        if not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if _is_present(value):
            daily.append(value)

    return ParsedRow(
        state=state.strip(),
        county_name=county_name,
        year=year,
        month=month,
        variable=variable,
        daily=daily,
    )


def aggregate_variable(variable: str, daily: list[float]) -> float | None:
    """Aggregate a month of daily values to the monthly figure.

    Temperature (TAVG/TMAX/TMIN) -> monthly mean; precipitation -> monthly
    total. Returns None when no day has data.
    """
    if not daily:
        return None
    if variable == "PRCP":
        return sum(daily)
    return sum(daily) / len(daily)


def california_monthly_values(csv_text: str, variable: str) -> dict[str, float]:
    """County-name -> monthly value (in weather-table units) for California.

    Filters to California rows, aggregates each county's daily values, and
    converts to the table's units (°F for temperature, inches for precip).
    """
    out: dict[str, float] = {}
    for line in csv_text.splitlines():
        row = parse_row(line)
        if row is None or row.state != "CA":
            continue
        native = aggregate_variable(row.variable, row.daily)
        if native is None:
            continue
        if row.variable == "PRCP":
            out[row.county_name] = mm_to_inches(native)
        else:
            out[row.county_name] = celsius_to_fahrenheit(native)
    return out


def build_csv_url(variable: str, year: int, month: int, quality: str = "scaled") -> str:
    """URL of the county-average CSV for one variable-month.

    quality: "scaled" (quality-controlled) or "prelim" (first ~3 days).
    """
    return f"{BASE_URL}/{year}/{variable}-{year}{month:02d}-cty-{quality}.csv"


def fetch_variable_csv(variable: str, year: int, month: int) -> str:
    """Fetch one variable-month CSV, preferring scaled and falling back to prelim.

    Recent months exist only as `prelim` until the quarterly quality-control
    pass promotes them to `scaled`, so a 404 on scaled retries prelim.
    """
    last_error: Exception | None = None
    for quality in ("scaled", "prelim"):
        url = build_csv_url(variable, year, month, quality=quality)
        for attempt in range(MAX_RETRIES):
            try:
                resp = httpx.get(url, timeout=60)
                if resp.status_code == 404:
                    break  # try the other quality tier
                resp.raise_for_status()
                return resp.text
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt < MAX_RETRIES - 1:
                    time.sleep(BACKOFF_BASE ** (attempt + 1))
    raise RuntimeError(
        f"nClimGrid fetch failed for {variable} {year}-{month:02d}: "
        f"{last_error or 'no scaled or prelim file found'}"
    )


def _iter_year_months(start_year: int, start_month: int, end_year: int, end_month: int):
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        yield (y, m)
        m += 1
        if m > 12:
            m = 1
            y += 1


def _default_year_months() -> list[tuple[int, int]]:
    """Trailing DEFAULT_MONTHS_BACK months, most recent last."""
    today = date.today()
    months: list[tuple[int, int]] = []
    y, m = today.year, today.month
    for _ in range(DEFAULT_MONTHS_BACK):
        months.append((y, m))
        m -= 1
        if m < 1:
            m = 12
            y -= 1
    return sorted(months)


@track_etl_run("weather")
def run(year_months: list[tuple[int, int]] | None = None):
    """Load nClimGrid county weather for the given (year, month) list.

    Defaults to the trailing months for the daily pipeline; pass an explicit
    list for a backfill.
    """
    if year_months is None:
        year_months = _default_year_months()

    db = SessionLocal()
    try:
        name_to_code = {
            name: code for code, name in db.query(County.code, County.name).all()
        }
        logger.info("Loaded %d county name->code mappings", len(name_to_code))

        total_rows = 0
        failed: list[tuple[int, int]] = []

        for year, month in year_months:
            try:
                # county_name -> {column: value}
                county_rows: dict[str, dict] = defaultdict(dict)
                for variable in VARIABLES:
                    csv_text = fetch_variable_csv(variable, year, month)
                    time.sleep(REQUEST_DELAY)
                    values = california_monthly_values(csv_text, variable.upper())
                    column = (
                        "precipitation_in"
                        if variable == "prcp"
                        else _TEMP_COLUMN[variable.upper()]
                    )
                    for county_name, value in values.items():
                        county_rows[county_name][column] = value

                rows = []
                for county_name, cols in county_rows.items():
                    code = name_to_code.get(county_name)
                    if code is None:
                        logger.warning(
                            "No county match for nClimGrid name %r — skipping",
                            county_name,
                        )
                        continue
                    rows.append({
                        "county_code": code,
                        "year": year,
                        "month": month,
                        "avg_temp_f": cols.get("avg_temp_f"),
                        "max_temp_f": cols.get("max_temp_f"),
                        "min_temp_f": cols.get("min_temp_f"),
                        "precipitation_in": cols.get("precipitation_in"),
                    })

                if rows:
                    stmt = pg_insert(Weather).values(rows)
                    stmt = stmt.on_conflict_do_update(
                        constraint="weather_county_code_year_month_key",
                        set_={
                            "avg_temp_f": stmt.excluded.avg_temp_f,
                            "max_temp_f": stmt.excluded.max_temp_f,
                            "min_temp_f": stmt.excluded.min_temp_f,
                            "precipitation_in": stmt.excluded.precipitation_in,
                        },
                    )
                    db.execute(stmt)
                    db.commit()
                    total_rows += len(rows)
                    logger.info("%d-%02d: %d county rows upserted", year, month, len(rows))

            except Exception as exc:
                logger.warning("Failed for %d-%02d: %s", year, month, exc)
                db.rollback()
                failed.append((year, month))

        if failed:
            # Loud partial failure (M-B9): a swallowed NCEI outage must not
            # record success. The months that loaded above were still committed.
            raise RuntimeError(
                f"nClimGrid weather: {len(failed)} month(s) failed "
                f"(first few: {failed[:5]})"
            )

        logger.info("Done. %d total weather rows upserted.", total_rows)

    finally:
        db.close()


def _parse_ym(value: str) -> tuple[int, int]:
    dt = datetime.strptime(value, "%Y-%m")
    return dt.year, dt.month


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Load NOAA nClimGrid-Daily county weather into Postgres"
    )
    parser.add_argument("--start", type=str, help="Start month YYYY-MM (backfill)")
    parser.add_argument("--end", type=str, help="End month YYYY-MM (backfill)")
    args = parser.parse_args()

    if args.start and args.end:
        sy, sm = _parse_ym(args.start)
        ey, em = _parse_ym(args.end)
        run(year_months=list(_iter_year_months(sy, sm, ey, em)))
    else:
        run()
