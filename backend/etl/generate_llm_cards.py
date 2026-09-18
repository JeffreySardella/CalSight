"""Generate high-quality LLM-written insight cards for all counties × years × angles.

Uses generate_narrative() which auto-rotates between API keys. Runs slowly
(5s between calls) to avoid rate limits and stay separate from Ask AI traffic.

Skips cards that already have an LLM-generated narrative unless --force.
Safe to interrupt and resume — picks up where it left off.

Every generated card passes a numeric gate: any number it states between 10
and 10,000,000 must be within 2% of a figure that was in the prompt (or a
rounded / per-day derivation of one). A failing card is retried once with
"Use only the exact figures provided."; if it still fails, nothing is stored
and the previous card stays.

Usage:
    python -m etl.generate_llm_cards                    # all counties, latest year
    python -m etl.generate_llm_cards all                # all counties, all years
    python -m etl.generate_llm_cards --counties alpine los_angeles --force
    python -m etl.generate_llm_cards --years 2001 2002 --force
    python -m etl.generate_llm_cards --statewide --years 2001 2002 --force
    python -m etl.generate_llm_cards --delay 10         # slower (10s between calls)

--statewide writes the LLM angles of ``statewide_insights`` (overview,
data_quality, historical_context, county_spotlight). Those rows were
hand-seeded in May 2026 with no generator in git; this is the generator.
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
from app.models import County, CountyInsightCard, StatewideInsight
from etl.fact_check import check_fact, unsupported_numbers
from etl.generate_fun_facts import _query_statewide_stats

logger = logging.getLogger(__name__)

# Appended to every prompt. Short on purpose — the numeric gate below is the
# real backstop; this just stops the model reaching for figures it wasn't given.
_GUARDRAILS = (
    " Use only the figures provided: no comparison to a national average or any "
    "figure not supplied; do not call the fatality rate low or high unless a "
    "statewide rate is supplied; do not invent explanations for the peak hour."
)

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
        "Write a single surprising fun fact about {county} County's crashes ({year}) that makes the "
        "scale relatable using only the figures given — per day, per resident, or share of the state. "
        "State what the data shows, not why. Data: {stats}"
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

STATEWIDE_ANGLE_PROMPTS: dict[str, str] = {
    "overview": (
        "Write a 2-3 sentence overview insight about California's statewide crash data for {year}. "
        "Lead with the most notable pattern. Data: {stats}"
    ),
    "data_quality": (
        "Write a 2-3 sentence insight about how complete California's {year} crash records are "
        "(share of records missing a cause, hour or coordinates) and what that means for reading "
        "the numbers. Data: {stats}"
    ),
    "historical_context": (
        "Write a 2-3 sentence insight placing California's {year} crash totals in the context of "
        "the surrounding years (yearly_totals). Data: {stats}"
    ),
    "county_spotlight": (
        "Write a 2-3 sentence insight spotlighting the county with the most crashes in California "
        "in {year} and its share of the statewide total. Data: {stats}"
    ),
}


# ---------------------------------------------------------------------------
# Numeric verification gate
# ---------------------------------------------------------------------------

# allowed_numbers / unsupported_numbers live in etl.fact_check (shared with the
# template generators and etl.audit_fun_facts).


def _problems(narrative: str, stats_str: str, year: int, angle: str) -> list[str]:
    """Fun facts get the full check_fact; other angles only the numeric gate
    (their prompts ask "why", so causal wording is expected there)."""
    if angle.startswith("fun_fact"):
        return check_fact(narrative, stats_str, year)
    bad = unsupported_numbers(narrative, stats_str, year)
    return [f"figures not in stats: {bad}"] if bad else []


def _generate_verified(
    prompt: str, stats_str: str, year: int, label: str, angle: str = "",
) -> str | None:
    """generate_narrative + write-time check; one retry, then None (keep old card)."""
    narrative = generate_narrative(prompt)
    bad = _problems(narrative, stats_str, year, angle)
    if bad:
        logger.warning("%s — %s; retrying", label, "; ".join(bad))
        retry = " Use only the exact figures provided."
        if angle.startswith("fun_fact"):
            retry = " State only what the figures show, not what caused them." + retry
        narrative = generate_narrative(prompt + retry)
        bad = _problems(narrative, stats_str, year, angle)
        if bad:
            logger.warning("%s — still %s; keeping previous card", label, "; ".join(bad))
            return None
    if not narrative or len(narrative) < 30:
        return None
    return narrative


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


def _build_statewide_stats_string(db: Session, year: int) -> tuple[str, dict] | None:
    """Compact statewide stats for the prompt, plus the totals stored on the row."""
    s = _query_statewide_stats(db, year)
    if not s:
        return None
    tc = s["tc"]
    parts = [
        f"total_crashes={tc:,}", f"killed={s['tk']:,}", f"injured={s['ti']:,}",
        f"fatality_rate={s['fatality_rate']}%", f"crashes_per_day={s['crashes_per_day']}",
        f"dui_pct={s['dui_pct']}%",
    ]
    if s["yoy"] is not None:
        parts.append(f"yoy_change={s['yoy']:+.1f}%")
    if s["top_cause"]:
        parts.append(f"top_cause={s['top_cause'][0]}({round(s['top_cause'][1] / tc * 100, 1)}%)")
    if s["peak_hour"]:
        parts.append(f"peak_hour={s['peak_hour'][0]}:00")
    if s["top_county"]:
        name, cnt = s["top_county"]
        parts.append(f"top_county={name}({cnt:,} crashes, {round(cnt / tc * 100, 1)}% of state)")
    if s["high_fat"]:
        parts.append(f"highest_fatality_rate_county={s['high_fat'][0]}({s['high_fat'][1]}%)")
    if s["low_fat"]:
        parts.append(f"lowest_fatality_rate_county={s['low_fat'][0]}({s['low_fat'][1]}%)")
    if s["high_dui"]:
        parts.append(f"highest_dui_county={s['high_dui'][0]}({s['high_dui'][1]}%)")

    dq = db.execute(text("""
        SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE canonical_cause IS NULL) / COUNT(*), 1) AS no_cause,
               ROUND(100.0 * COUNT(*) FILTER (WHERE crash_hour IS NULL) / COUNT(*), 1) AS no_hour,
               ROUND(100.0 * COUNT(*) FILTER (WHERE latitude IS NULL) / COUNT(*), 1) AS no_coords
        FROM crashes WHERE crash_year = :y
    """), {"y": year}).one()
    parts.append(
        f"missing_cause={dq.no_cause}%, missing_hour={dq.no_hour}%, missing_coords={dq.no_coords}%"
    )

    hist = db.execute(text("""
        SELECT crash_year, COUNT(*) AS cnt FROM crashes
        WHERE crash_year BETWEEN :y - 5 AND :y + 1
          AND crash_year < EXTRACT(year FROM CURRENT_DATE)
        GROUP BY crash_year ORDER BY crash_year
    """), {"y": year}).all()
    parts.append("yearly_totals=" + ",".join(f"{r.crash_year}:{r.cnt}" for r in hist))

    totals = {"total_crashes": tc, "total_killed": s["tk"], "total_injured": s["ti"]}
    return ", ".join(parts), totals


def _run_statewide(db: Session, mode: str, years: list[int] | None, force: bool, delay: int) -> int:
    if not years:
        rows = db.execute(text("""
            SELECT crash_year FROM crashes
            WHERE crash_year < EXTRACT(year FROM CURRENT_DATE)
            GROUP BY crash_year HAVING COUNT(*) >= 1000
            ORDER BY crash_year DESC
        """)).all()
        years = [r[0] for r in rows]
        if mode != "all":
            years = years[:1]

    created = skipped = 0
    for year in years:
        built = _build_statewide_stats_string(db, year)
        if not built:
            continue
        stats_str, totals = built
        for angle, tpl in STATEWIDE_ANGLE_PROMPTS.items():
            existing = db.query(StatewideInsight).filter_by(year=year, angle=angle).first()
            if existing and not force and existing.narrative and len(existing.narrative) > 50:
                skipped += 1
                continue
            label = f"statewide/{year}/{angle}"
            try:
                narrative = _generate_verified(
                    tpl.format(year=year, stats=stats_str) + _GUARDRAILS, stats_str, year, label, angle,
                )
                if narrative is None:
                    continue
                stmt = (
                    pg_insert(StatewideInsight)
                    .values(
                        year=year, angle=angle, narrative=narrative,
                        data_source="switrs" if year <= 2015 else "ccrs", **totals,
                    )
                    .on_conflict_do_update(
                        index_elements=["year", "angle"],
                        set_=dict(narrative=narrative, **totals),
                    )
                )
                db.execute(stmt)
                db.commit()
                created += 1
                logger.info("%s — generated", label)
            except Exception as exc:
                logger.warning("%s — LLM error: %s", label, exc)
                db.rollback()
            finally:
                time.sleep(delay)

    logger.info("Statewide LLM cards: %d created, %d skipped", created, skipped)
    return created


def _norm(name: str) -> str:
    return name.lower().replace("-", "_").replace(" ", "_")


def run(
    mode: str = "latest",
    delay: int = 5,
    years: list[int] | None = None,
    counties: list[str] | None = None,
    force: bool = False,
    statewide: bool = False,
) -> int:
    """Generate LLM insight cards.

    ``years`` overrides the mode's year selection; ``force`` rewrites cards
    that already have a narrative; ``counties`` are names with spaces as
    underscores (``los_angeles``) so they pass the ETL workflow's arg allowlist.
    """
    db = SessionLocal()
    try:
        if statewide:
            return _run_statewide(db, mode, years, force, delay)

        county_rows = db.query(County).order_by(County.name).all()
        if counties:
            wanted = {_norm(c) for c in counties}
            county_rows = [c for c in county_rows if _norm(c.name) in wanted]
            if not county_rows:
                logger.error("No county matched: %s", counties)
                return 0

        created = 0
        skipped = 0
        errors = 0

        for county in county_rows:
            if years:
                county_years = list(years)
            elif mode == "all":
                county_years = [r[0] for r in db.execute(text("""
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
                county_years = [yr] if yr else []

            for year in county_years:
                stats_str = _build_stats_string(db, county.code, year)
                if not stats_str:
                    continue

                for angle, prompt_tpl in ANGLE_PROMPTS.items():
                    existing = (
                        db.query(CountyInsightCard)
                        .filter_by(county_code=county.code, year=year, angle=angle)
                        .first()
                    )
                    if existing and not force and existing.narrative and len(existing.narrative) > 50:
                        skipped += 1
                        continue

                    prompt = prompt_tpl.format(
                        county=county.name, year=year, stats=stats_str,
                    ) + _GUARDRAILS
                    label = f"{county.name}/{year}/{angle}"

                    try:
                        narrative = _generate_verified(prompt, stats_str, year, label, angle)
                        if narrative is None:
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
                        logger.info("%s — generated (%d total)", label, created)

                    except Exception as exc:
                        errors += 1
                        logger.warning("%s — LLM error: %s", label, exc)
                        db.rollback()
                    finally:
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
    parser.add_argument("--counties", nargs="+", default=None,
                        help="county names, spaces as underscores (alpine los_angeles)")
    parser.add_argument("--years", nargs="+", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="rewrite cards that already have a narrative")
    parser.add_argument("--statewide", action="store_true",
                        help="write the LLM angles of statewide_insights instead of county cards")
    parser.add_argument("--delay", type=int, default=5)
    args = parser.parse_args()
    run(
        mode=args.mode, delay=args.delay, years=args.years,
        counties=args.counties, force=args.force, statewide=args.statewide,
    )
