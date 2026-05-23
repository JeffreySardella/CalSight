"""Generate high-quality LLM-written insight cards for all counties × years × angles.

Uses generate_narrative() which auto-rotates between API keys. Runs slowly
(5s between calls) to avoid rate limits and stay separate from Ask AI traffic.

Skips cards that already have an LLM-generated narrative (narrative starting
with a non-template pattern). Safe to interrupt and resume — picks up where
it left off.

Usage:
    python -m etl.generate_llm_cards                    # all counties, latest year
    python -m etl.generate_llm_cards all                # all counties, all years
    python -m etl.generate_llm_cards --county "Los Angeles"  # single county
    python -m etl.generate_llm_cards --delay 10         # slower (10s between calls)
"""

from __future__ import annotations

import argparse
import logging
import time

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import EtlSessionLocal as SessionLocal
from app.llm import generate_narrative
from app.models import County, CountyInsightCard

logger = logging.getLogger(__name__)

ANGLE_PROMPTS: dict[str, str] = {
    "overview": (
        "Write a 2-3 sentence overview insight about {county} County's crash data for {year}. "
        "Lead with the most surprising finding. Data: {stats}"
    ),
    "dui": (
        "Write a 2-3 sentence insight about DUI/alcohol-related crashes in {county} County ({year}). "
        "Compare to the state average and mention what's unusual. Data: {stats}"
    ),
    "cause_focus": (
        "Write a 2-3 sentence insight about what causes crashes in {county} County ({year}). "
        "Focus on the dominant cause and whether it's unusual vs other counties. Data: {stats}"
    ),
    "trend": (
        "Write a 2-3 sentence insight about how crash trends have changed over time in {county} County. "
        "Are things getting better or worse? Why might that be? Data: {stats}"
    ),
    "safety_ranking": (
        "Write a 2-3 sentence insight about where {county} County ranks for safety among California's "
        "58 counties ({year}). Include rank and what drives it. Data: {stats}"
    ),
    "unique_factor": (
        "Write a 2-3 sentence insight about what makes {county} County's crash profile distinctive "
        "compared to the rest of California ({year}). What stands out? Data: {stats}"
    ),
    "geography": (
        "Write a 2-3 sentence insight about how {county} County's geography (urban/rural, highways, "
        "density) shapes its crash patterns ({year}). Data: {stats}"
    ),
    "seasonal": (
        "Write a 2-3 sentence insight about seasonal crash patterns in {county} County ({year}). "
        "When are crashes most/least common and why? Data: {stats}"
    ),
    "pedestrian": (
        "Write a 2-3 sentence insight about pedestrian safety in {county} County ({year}). "
        "How does the pedestrian crash rate compare to statewide? Data: {stats}"
    ),
    "cyclist": (
        "Write a 2-3 sentence insight about cyclist safety in {county} County ({year}). Data: {stats}"
    ),
    "hit_and_run": (
        "Write a 2-3 sentence insight about hit-and-run crashes in {county} County ({year}). "
        "Compare to statewide rate. Data: {stats}"
    ),
    "time_of_day": (
        "Write a 2-3 sentence insight about when crashes happen in {county} County ({year}). "
        "What's the most dangerous hour and why? Data: {stats}"
    ),
    "weekend_weekday": (
        "Write a 2-3 sentence insight comparing weekend vs weekday crashes in {county} County ({year}). "
        "Data: {stats}"
    ),
    "fatality_paradox": (
        "Write a 2-3 sentence insight about the relationship between crash volume and fatality rate "
        "in {county} County ({year}). Is it high volume/low fatality or vice versa? Why? Data: {stats}"
    ),
    "nighttime": (
        "Write a 2-3 sentence insight about nighttime crashes in {county} County ({year}). "
        "How do dark hours compare to daytime? Data: {stats}"
    ),
    "speeding": (
        "Write a 2-3 sentence insight about speed-related crashes in {county} County ({year}). Data: {stats}"
    ),
    "what_if": (
        "Write a 2-3 sentence 'what if' projection for {county} County ({year}). "
        "If all of California matched this county's crash rate, how many more/fewer crashes and deaths "
        "would there be? Make it concrete and vivid. Data: {stats}"
    ),
    "fun_fact_timing": (
        "Write a single surprising fun fact about crash timing in {county} County ({year}). "
        "Make it memorable — 'one crash every X minutes' or similar. Data: {stats}"
    ),
    "fun_fact_comparison": (
        "Write a single surprising fun fact comparing {county} County's crashes ({year}) to something "
        "relatable — a city population, a stadium capacity, etc. Make it stick. Data: {stats}"
    ),
    "fun_fact_records": (
        "Write a single fun fact about what record or extreme {county} County holds for California "
        "crash data ({year}). Data: {stats}"
    ),
    "decade_comparison": (
        "Write a 2-3 sentence insight comparing {county} County's recent crash data to a decade ago. "
        "What's changed? Data: {stats}"
    ),
    "income_inequality": (
        "Write a 2-3 sentence insight about how income and poverty relate to crash patterns in "
        "{county} County ({year}). Data: {stats}"
    ),
    "commuter": (
        "Write a 2-3 sentence insight about commuter patterns and crashes in {county} County ({year}). "
        "Data: {stats}"
    ),
    "highway": (
        "Write a 2-3 sentence insight about highway vs local road crashes in {county} County ({year}). "
        "Data: {stats}"
    ),
    "severity_breakdown": (
        "Write a 2-3 sentence insight about crash severity in {county} County ({year}). "
        "What proportion are fatal vs injury vs property-damage-only? How does this compare? Data: {stats}"
    ),
    "population_density": (
        "Write a 2-3 sentence insight about how population density affects crashes in {county} County "
        "({year}). Data: {stats}"
    ),
    "holiday": (
        "Write a 2-3 sentence insight about holiday-season (October-December) crashes in {county} County "
        "({year}). Data: {stats}"
    ),
    "recovery_pattern": (
        "Write a 2-3 sentence insight about post-COVID crash recovery patterns in {county} County. "
        "How did 2020 compare to before and after? Data: {stats}"
    ),
}


def _build_stats_string(db: Session, county_code: int, year: int) -> str | None:
    """Build a compact stats string for the LLM prompt."""
    t = db.execute(text("""
        SELECT COUNT(*) AS tc,
               COALESCE(SUM(number_killed),0) AS tk,
               COALESCE(SUM(number_injured),0) AS ti
        FROM crashes WHERE county_code = :c AND crash_year = :y
    """), {"c": county_code, "y": year}).one()
    if t.tc == 0:
        return None

    causes = db.execute(text("""
        SELECT canonical_cause, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND canonical_cause IS NOT NULL
        GROUP BY canonical_cause ORDER BY cnt DESC LIMIT 5
    """), {"c": county_code, "y": year}).all()

    peak = db.execute(text("""
        SELECT crash_hour, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND crash_hour IS NOT NULL
        GROUP BY crash_hour ORDER BY cnt DESC LIMIT 1
    """), {"c": county_code, "y": year}).first()

    pop = db.execute(text("SELECT population FROM counties WHERE code = :c"), {"c": county_code}).scalar()

    # State totals for comparison
    st = db.execute(text("""
        SELECT COUNT(*) AS tc, COALESCE(SUM(number_killed),0) AS tk
        FROM crashes WHERE crash_year = :y
    """), {"y": year}).one()

    rank = db.execute(text("""
        SELECT rank FROM (
            SELECT county_code, RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
            FROM crashes WHERE crash_year = :y GROUP BY county_code
        ) sub WHERE county_code = :c
    """), {"c": county_code, "y": year}).first()

    # Historical for trend
    hist = db.execute(text("""
        SELECT crash_year, COUNT(*) AS cnt, SUM(number_killed) AS k
        FROM crashes WHERE county_code = :c AND crash_year BETWEEN :y - 5 AND :y
        GROUP BY crash_year ORDER BY crash_year
    """), {"c": county_code, "y": year}).all()

    demo = db.execute(text("""
        SELECT population_density, median_income, poverty_rate, commute_drive_alone_pct
        FROM demographics WHERE county_code = :c AND year = :y LIMIT 1
    """), {"c": county_code, "y": year}).first()

    parts = [
        f"total_crashes={t.tc:,}", f"killed={t.tk:,}", f"injured={t.ti:,}",
        f"fatality_rate={round(t.tk/t.tc*100,2)}%",
    ]
    if causes:
        parts.append(f"top_causes={', '.join(f'{r.canonical_cause}({round(r.cnt/t.tc*100,1)}%)' for r in causes[:3])}")
    if peak:
        parts.append(f"peak_hour={peak.crash_hour}:00")
    if pop:
        parts.append(f"population={pop:,}")
        parts.append(f"per_100k={round(t.tc/pop*100_000)}")
    if rank:
        parts.append(f"rank={rank.rank}/58")
    parts.append(f"state_total={st.tc:,}")
    parts.append(f"county_share={round(t.tc/st.tc*100,2)}%")
    if hist and len(hist) >= 2:
        first, last = hist[0], hist[-1]
        if first.cnt > 0:
            change = round((last.cnt - first.cnt) / first.cnt * 100, 1)
            parts.append(f"5yr_trend={change:+.1f}%")
    if demo:
        if demo.population_density:
            parts.append(f"density={round(demo.population_density)}/sqmi")
        if demo.median_income:
            parts.append(f"income=${demo.median_income:,}")
        if demo.poverty_rate is not None:
            parts.append(f"poverty={demo.poverty_rate:.1f}%")

    inv = db.execute(text("""
        SELECT
            COALESCE(SUM(CASE WHEN pedestrian_involved THEN 1 ELSE 0 END), 0) AS ped,
            COALESCE(SUM(CASE WHEN cyclist_involved THEN 1 ELSE 0 END), 0) AS cyc,
            COALESCE(SUM(CASE WHEN hit_run IS NOT NULL THEN 1 ELSE 0 END), 0) AS hr,
            COALESCE(SUM(CASE WHEN canonical_cause = 'speeding' THEN 1 ELSE 0 END), 0) AS spd
        FROM crashes WHERE county_code = :c AND crash_year = :y
    """), {"c": county_code, "y": year}).first()
    if inv:
        parts.append(f"pedestrian_crashes={inv.ped}")
        parts.append(f"cyclist_crashes={inv.cyc}")
        parts.append(f"hit_run_crashes={inv.hr}")
        parts.append(f"speeding_crashes={inv.spd}")

    monthly = db.execute(text("""
        SELECT crash_month, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND crash_month IS NOT NULL
        GROUP BY crash_month ORDER BY crash_month
    """), {"c": county_code, "y": year}).all()
    if monthly:
        month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        parts.append("monthly=" + ",".join(f"{month_names[r.crash_month-1]}:{r.cnt}" for r in monthly))

    dow = db.execute(text("""
        SELECT day_of_week_num, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND day_of_week_num IS NOT NULL
        GROUP BY day_of_week_num ORDER BY day_of_week_num
    """), {"c": county_code, "y": year}).all()
    if dow:
        dow_names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
        parts.append("day_of_week=" + ",".join(f"{dow_names[r.day_of_week_num]}:{r.cnt}" for r in dow))

    night = db.execute(text("""
        SELECT COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
            AND crash_hour IS NOT NULL AND (crash_hour >= 20 OR crash_hour < 6)
    """), {"c": county_code, "y": year}).scalar() or 0
    if t.tc > 0:
        parts.append(f"nighttime_crashes={night}({round(night/t.tc*100,1)}%)")

    return ", ".join(parts)


def run(
    mode: str = "latest",
    county_filter: str | None = None,
    delay: int = 5,
) -> int:
    """Generate LLM insight cards."""
    db = SessionLocal()
    try:
        counties = db.query(County).order_by(County.name).all()
        if county_filter:
            counties = [c for c in counties if c.name.lower() == county_filter.lower()]
            if not counties:
                logger.error("County not found: %s", county_filter)
                return 0

        created = 0
        skipped = 0
        errors = 0

        for county in counties:
            if mode == "all":
                years = [r[0] for r in db.execute(text("""
                    SELECT crash_year FROM crashes WHERE county_code = :c
                    GROUP BY crash_year HAVING COUNT(*) >= 50
                    ORDER BY crash_year DESC
                """), {"c": county.code}).all()]
            else:
                yr = db.execute(text("""
                    SELECT crash_year FROM crashes WHERE county_code = :c
                      AND crash_year < EXTRACT(year FROM CURRENT_DATE)
                    GROUP BY crash_year HAVING COUNT(*) >= 50
                    ORDER BY crash_year DESC LIMIT 1
                """), {"c": county.code}).scalar()
                years = [yr] if yr else []

            for year in years:
                stats_str = _build_stats_string(db, county.code, year)
                if not stats_str:
                    continue

                for angle, prompt_tpl in ANGLE_PROMPTS.items():
                    existing = (
                        db.query(CountyInsightCard)
                        .filter_by(county_code=county.code, year=year, angle=angle)
                        .first()
                    )
                    if existing and existing.narrative and len(existing.narrative) > 50:
                        skipped += 1
                        continue

                    prompt = prompt_tpl.format(
                        county=county.name, year=year, stats=stats_str,
                    )

                    try:
                        narrative = generate_narrative(prompt)
                        if not narrative or len(narrative) < 30:
                            continue

                        stmt = (
                            pg_insert(CountyInsightCard)
                            .values(
                                county_code=county.code,
                                county_name=county.name,
                                year=year,
                                angle=angle,
                                narrative=narrative,
                            )
                            .on_conflict_do_update(
                                index_elements=["county_code", "year", "angle"],
                                set_=dict(narrative=narrative),
                            )
                        )
                        db.execute(stmt)
                        db.commit()
                        created += 1
                        logger.info("%s/%d/%s — generated (%d total)", county.name, year, angle, created)

                    except Exception as exc:
                        errors += 1
                        logger.warning("%s/%d/%s — LLM error: %s", county.name, year, angle, exc)
                        db.rollback()

                    time.sleep(delay)

            logger.info("%s complete — %d created so far", county.name, created)

        logger.info("LLM cards: %d created, %d skipped, %d errors", created, skipped, errors)
        return created
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", default="latest", choices=["latest", "all"])
    parser.add_argument("--county", type=str, default=None)
    parser.add_argument("--delay", type=int, default=5)
    args = parser.parse_args()
    run(mode=args.mode, county_filter=args.county, delay=args.delay)
