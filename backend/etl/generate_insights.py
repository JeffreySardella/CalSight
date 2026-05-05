"""ETL step 18 — generate per-county AI insight cards.

For each of the 58 California counties this script:

1. Queries deterministic crash stats for the latest full year available:
   total crashes, fatalities, injuries, YoY change, top cause + %, peak
   crash hour, DUI %, and crash rate per capita.

2. Queries census demographics as prompt context (population, median income,
   commute split, poverty rate, population density). These are NOT stored in
   the DB — they exist only to enrich the LLM prompt.

3. Calls the configured LLM provider to generate a 2–3 sentence narrative
   (see ``app.llm``). If the call fails the county is skipped — the rest of
   the pipeline continues and the frontend renders ``narrative: null``
   gracefully.

4. Upserts into ``county_insights`` (one row per county per year). Structured
   stats are always written. Narrative is written only when the LLM succeeds.

Rate limit
----------
A 1-second sleep between LLM calls keeps us well within typical provider
rate limits. 58 counties = ~1 minute total.

Usage
-----
::

    # As part of the full ETL run (step 18):
    python -m etl.generate_insights

    # Standalone for a quick test:
    cd backend
    python -m etl.generate_insights
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.llm import generate_narrative
from app.models import County, CountyInsight
from etl._utils import track_etl_run

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_PROMPT_TEMPLATE = (
    "You're a data analyst writing a 2-3 sentence insight about {county} County's "
    "crash data. Be engaging — mix one surprising comparison or fun fact with the "
    "key trend. Data: {stats}. Don't restate raw numbers — the UI already shows "
    "those. Focus on what's *interesting*."
)


# ---------------------------------------------------------------------------
# Stat queries
# ---------------------------------------------------------------------------

_MIN_CRASHES_FOR_FULL_YEAR = 50


def _all_years(db: Session, county_code: int) -> list[int]:
    """Return all crash years with enough data for this county."""
    rows = db.execute(
        text(
            "SELECT crash_year FROM crashes "
            "WHERE county_code = :c "
            "GROUP BY crash_year "
            "HAVING COUNT(*) >= :min "
            "ORDER BY crash_year DESC"
        ),
        {"c": county_code, "min": _MIN_CRASHES_FOR_FULL_YEAR},
    ).all()
    return [r[0] for r in rows]


def _latest_year(db: Session, county_code: int) -> int | None:
    """Return the most recent full crash year for this county.

    Skips partial years (e.g. current calendar year with only a few hundred
    records) by requiring at least _MIN_CRASHES_FOR_FULL_YEAR crashes.
    """
    row = db.execute(
        text(
            "SELECT crash_year FROM crashes "
            "WHERE county_code = :c "
            "GROUP BY crash_year "
            "HAVING COUNT(*) >= :min "
            "ORDER BY crash_year DESC LIMIT 1"
        ),
        {"c": county_code, "min": _MIN_CRASHES_FOR_FULL_YEAR},
    ).scalar()
    return row  # type: ignore[return-value]


def _query_stats(
    db: Session, county_code: int, year: int
) -> dict | None:
    """Return deterministic crash stats dict for the county/year.

    Returns None if there's no crash data at all (shouldn't happen after
    ``_latest_year`` but guards against edge cases).
    """
    # --- grand totals ---
    totals = db.execute(
        text(
            """
            SELECT
                COUNT(*)                        AS total_crashes,
                COALESCE(SUM(number_killed), 0) AS total_killed,
                COALESCE(SUM(number_injured),0) AS total_injured
            FROM crashes
            WHERE county_code = :c AND crash_year = :y
            """
        ),
        {"c": county_code, "y": year},
    ).one()

    if totals.total_crashes == 0:
        return None

    # --- YoY change vs prior year ---
    prior = db.execute(
        text(
            "SELECT COUNT(*) AS cnt FROM crashes "
            "WHERE county_code = :c AND crash_year = :y"
        ),
        {"c": county_code, "y": year - 1},
    ).scalar() or 0

    if prior > 0:
        yoy_change_pct = round(
            ((totals.total_crashes - prior) / prior) * 100, 2
        )
    else:
        yoy_change_pct = None

    # --- top canonical_cause ---
    cause_row = db.execute(
        text(
            """
            SELECT
                canonical_cause,
                COUNT(*) AS cnt
            FROM crashes
            WHERE county_code = :c AND crash_year = :y
              AND canonical_cause IS NOT NULL
            GROUP BY canonical_cause
            ORDER BY cnt DESC
            LIMIT 1
            """
        ),
        {"c": county_code, "y": year},
    ).first()

    top_cause = cause_row.canonical_cause if cause_row else None
    top_cause_pct = (
        round((cause_row.cnt / totals.total_crashes) * 100, 2)
        if cause_row else None
    )

    # --- peak crash hour ---
    hour_row = db.execute(
        text(
            """
            SELECT crash_hour, COUNT(*) AS cnt
            FROM crashes
            WHERE county_code = :c AND crash_year = :y
              AND crash_hour IS NOT NULL
            GROUP BY crash_hour
            ORDER BY cnt DESC
            LIMIT 1
            """
        ),
        {"c": county_code, "y": year},
    ).first()
    peak_hour = hour_row.crash_hour if hour_row else None

    # --- DUI % ---
    dui_count = db.execute(
        text(
            "SELECT COUNT(*) FROM crashes "
            "WHERE county_code = :c AND crash_year = :y "
            "AND canonical_cause = 'dui'"
        ),
        {"c": county_code, "y": year},
    ).scalar() or 0

    dui_pct = round((dui_count / totals.total_crashes) * 100, 2)

    # --- crash rate per capita (from counties.population) ---
    pop = db.execute(
        text("SELECT population FROM counties WHERE code = :c"),
        {"c": county_code},
    ).scalar()

    crash_rate_per_capita = (
        round((totals.total_crashes / pop) * 100_000, 2)
        if pop and pop > 0 else None
    )

    return {
        "total_crashes": totals.total_crashes,
        "total_killed": totals.total_killed,
        "total_injured": totals.total_injured,
        "yoy_change_pct": yoy_change_pct,
        "top_cause": top_cause,
        "top_cause_pct": top_cause_pct,
        "peak_hour": peak_hour,
        "dui_pct": dui_pct,
        "crash_rate_per_capita": crash_rate_per_capita,
    }


def _query_demographics(
    db: Session, county_code: int, year: int
) -> dict:
    """Return demographic context for the LLM prompt (not stored in DB).

    Falls back to an empty dict if no demographics row exists for this year
    (some early years or small counties may be missing).
    """
    row = db.execute(
        text(
            """
            SELECT
                population,
                median_income,
                commute_drive_alone_pct,
                commute_transit_pct,
                poverty_rate,
                population_density
            FROM demographics
            WHERE county_code = :c AND year = :y
            LIMIT 1
            """
        ),
        {"c": county_code, "y": year},
    ).first()

    if row is None:
        return {}

    return {
        "population": row.population,
        "median_income": row.median_income,
        "commute_drive_alone_pct": row.commute_drive_alone_pct,
        "commute_transit_pct": row.commute_transit_pct,
        "poverty_rate": row.poverty_rate,
        "population_density": row.population_density,
    }


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _build_prompt(county_name: str, stats: dict, demo: dict) -> str:
    parts = [
        f"total_crashes={stats['total_crashes']}",
        f"total_killed={stats['total_killed']}",
    ]
    if stats.get("yoy_change_pct") is not None:
        parts.append(f"yoy_change={stats['yoy_change_pct']:+.1f}%")
    if stats.get("top_cause"):
        parts.append(
            f"top_cause={stats['top_cause']} ({stats['top_cause_pct']:.1f}%)"
        )
    if stats.get("peak_hour") is not None:
        parts.append(f"peak_hour={stats['peak_hour']}:00")
    if stats.get("dui_pct") is not None:
        parts.append(f"dui_pct={stats['dui_pct']:.1f}%")
    if demo.get("population"):
        parts.append(f"population={demo['population']:,}")
    if demo.get("median_income"):
        parts.append(f"median_income=${demo['median_income']:,}")
    if demo.get("poverty_rate") is not None:
        parts.append(f"poverty_rate={demo['poverty_rate']:.1f}%")
    if demo.get("population_density") is not None:
        parts.append(f"pop_density={demo['population_density']:.0f}/sq mi")

    return _PROMPT_TEMPLATE.format(
        county=county_name,
        stats=", ".join(parts),
    )


# ---------------------------------------------------------------------------
# Main ETL function
# ---------------------------------------------------------------------------

@track_etl_run("generate_insights")
def run() -> int:
    """Generate insight cards for all counties. Returns number of rows upserted."""
    db = SessionLocal()
    try:
        counties: list[County] = (
            db.query(County).order_by(County.name).all()
        )
        upserted = 0

        for county in counties:
            # ---- Step 1: latest year ----
            year = _latest_year(db, county.code)
            if year is None:
                logger.warning(
                    "No crash data for %s (code=%d) — skipping",
                    county.name, county.code,
                )
                continue

            # ---- Step 2: structured stats ----
            stats = _query_stats(db, county.code, year)
            if stats is None:
                logger.warning(
                    "Zero crashes for %s in %d — skipping",
                    county.name, year,
                )
                continue

            # ---- Step 3: demographics (prompt context only) ----
            demo = _query_demographics(db, county.code, year)

            # ---- Step 4: LLM narrative ----
            narrative: str | None = None
            try:
                prompt = _build_prompt(county.name, stats, demo)
                narrative = generate_narrative(prompt)
                logger.info(
                    "Generated narrative for %s (%d)", county.name, year
                )
            except Exception as exc:
                logger.error(
                    "LLM failed for %s: %s — storing stats without narrative",
                    county.name, exc,
                )

            # ---- Step 5: upsert ----
            now = datetime.now(tz=timezone.utc)
            stmt = (
                pg_insert(CountyInsight)
                .values(
                    county_code=county.code,
                    year=year,
                    total_crashes=stats["total_crashes"],
                    total_killed=stats["total_killed"],
                    total_injured=stats["total_injured"],
                    crash_rate_per_capita=stats["crash_rate_per_capita"],
                    top_cause=stats["top_cause"],
                    top_cause_pct=stats["top_cause_pct"],
                    yoy_change_pct=stats["yoy_change_pct"],
                    peak_hour=stats["peak_hour"],
                    dui_pct=stats["dui_pct"],
                    narrative=narrative,
                    generated_at=now if narrative else None,
                )
                .on_conflict_do_update(
                    index_elements=["county_code", "year"],
                    set_=dict(
                        total_crashes=stats["total_crashes"],
                        total_killed=stats["total_killed"],
                        total_injured=stats["total_injured"],
                        crash_rate_per_capita=stats["crash_rate_per_capita"],
                        top_cause=stats["top_cause"],
                        top_cause_pct=stats["top_cause_pct"],
                        yoy_change_pct=stats["yoy_change_pct"],
                        peak_hour=stats["peak_hour"],
                        dui_pct=stats["dui_pct"],
                        narrative=narrative,
                        generated_at=now if narrative else None,
                    ),
                )
            )
            db.execute(stmt)
            db.commit()
            upserted += 1

            # Rate-limit LLM calls — 3 s between counties (~3 min total)
            time.sleep(3)

        logger.info("generate_insights complete: %d counties upserted", upserted)
        return upserted

    finally:
        db.close()


_ALL_YEARS_DELAY = 12


def run_all_years() -> int:
    """Generate insight cards for all counties across all available years."""
    db = SessionLocal()
    try:
        counties: list[County] = (
            db.query(County).order_by(County.name).all()
        )
        upserted = 0
        skipped_existing = 0

        for county in counties:
            years = _all_years(db, county.code)
            if not years:
                logger.warning(
                    "No crash data for %s (code=%d) — skipping",
                    county.name, county.code,
                )
                continue

            for year in years:
                existing = (
                    db.query(CountyInsight)
                    .filter(
                        CountyInsight.county_code == county.code,
                        CountyInsight.year == year,
                        CountyInsight.narrative.isnot(None),
                    )
                    .first()
                )
                if existing:
                    skipped_existing += 1
                    continue

                stats = _query_stats(db, county.code, year)
                if stats is None:
                    continue

                demo = _query_demographics(db, county.code, year)

                narrative: str | None = None
                try:
                    prompt = _build_prompt(county.name, stats, demo)
                    narrative = generate_narrative(prompt)
                    logger.info(
                        "Generated narrative for %s (%d)", county.name, year
                    )
                except Exception as exc:
                    logger.error(
                        "LLM failed for %s %d: %s", county.name, year, exc
                    )

                now = datetime.now(tz=timezone.utc)
                stmt = (
                    pg_insert(CountyInsight)
                    .values(
                        county_code=county.code,
                        year=year,
                        total_crashes=stats["total_crashes"],
                        total_killed=stats["total_killed"],
                        total_injured=stats["total_injured"],
                        crash_rate_per_capita=stats["crash_rate_per_capita"],
                        top_cause=stats["top_cause"],
                        top_cause_pct=stats["top_cause_pct"],
                        yoy_change_pct=stats["yoy_change_pct"],
                        peak_hour=stats["peak_hour"],
                        dui_pct=stats["dui_pct"],
                        narrative=narrative,
                        generated_at=now if narrative else None,
                    )
                    .on_conflict_do_update(
                        index_elements=["county_code", "year"],
                        set_=dict(
                            total_crashes=stats["total_crashes"],
                            total_killed=stats["total_killed"],
                            total_injured=stats["total_injured"],
                            crash_rate_per_capita=stats["crash_rate_per_capita"],
                            top_cause=stats["top_cause"],
                            top_cause_pct=stats["top_cause_pct"],
                            yoy_change_pct=stats["yoy_change_pct"],
                            peak_hour=stats["peak_hour"],
                            dui_pct=stats["dui_pct"],
                            narrative=narrative,
                            generated_at=now if narrative else None,
                        ),
                    )
                )
                db.execute(stmt)
                db.commit()
                upserted += 1

                time.sleep(_ALL_YEARS_DELAY)

        logger.info(
            "generate_insights (all years) complete: %d upserted, %d skipped (existing)",
            upserted, skipped_existing,
        )
        return upserted

    finally:
        db.close()


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    mode = sys.argv[1] if len(sys.argv) > 1 else "latest"
    if mode == "all":
        sys.exit(0 if run_all_years() is not None else 1)
    else:
        sys.exit(0 if run() is not None else 1)
