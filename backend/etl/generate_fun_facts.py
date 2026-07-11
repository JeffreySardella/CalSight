"""Generate fun-fact insight cards using deterministic templates + real data.

No LLM calls — narratives are composed from handcrafted templates filled
with actual crash statistics.  Multiple template variants per angle keep
the cards from feeling repetitive.

Usage
-----
::

    cd backend
    python -m etl.generate_fun_facts              # county + statewide
    python -m etl.generate_fun_facts county        # county only
    python -m etl.generate_fun_facts statewide     # statewide only
"""

from __future__ import annotations

import hashlib
import logging
import random

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, CountyInsightCard, StatewideInsight

logger = logging.getLogger(__name__)

DOW_NAMES = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday",
             4: "Friday", 5: "Saturday", 6: "Sunday"}
MONTH_NAMES = {1: "January", 2: "February", 3: "March", 4: "April",
               5: "May", 6: "June", 7: "July", 8: "August",
               9: "September", 10: "October", 11: "November", 12: "December"}


def _fmt(n: int | float) -> str:
    if isinstance(n, float):
        return f"{n:,.1f}"
    return f"{n:,}"


def _hour_label(h: int) -> str:
    if h == 0:
        return "midnight"
    if h == 12:
        return "noon"
    return f"{h % 12} {'AM' if h < 12 else 'PM'}"


# ---------------------------------------------------------------------------
# County stat queries
# ---------------------------------------------------------------------------

def _query_county_stats(db: Session, county_code: int, year: int) -> dict | None:
    totals = db.execute(text("""
        SELECT COUNT(*) AS total_crashes,
               COALESCE(SUM(number_killed), 0) AS total_killed,
               COALESCE(SUM(number_injured), 0) AS total_injured
        FROM crashes WHERE county_code = :c AND crash_year = :y
    """), {"c": county_code, "y": year}).one()

    if totals.total_crashes == 0:
        return None

    tc = totals.total_crashes
    tk = totals.total_killed
    ti = totals.total_injured

    # Day of week
    dow_rows = db.execute(text("""
        SELECT day_of_week_num, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
          AND day_of_week_num IS NOT NULL
        GROUP BY day_of_week_num ORDER BY cnt DESC
    """), {"c": county_code, "y": year}).all()
    dow = {r.day_of_week_num: r.cnt for r in dow_rows} if dow_rows else {}

    # Month
    month_rows = db.execute(text("""
        SELECT crash_month, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
          AND crash_month IS NOT NULL
        GROUP BY crash_month ORDER BY cnt DESC
    """), {"c": county_code, "y": year}).all()
    months = {r.crash_month: r.cnt for r in month_rows} if month_rows else {}

    # Peak hour
    hour_row = db.execute(text("""
        SELECT crash_hour, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
          AND crash_hour IS NOT NULL
        GROUP BY crash_hour ORDER BY cnt DESC LIMIT 1
    """), {"c": county_code, "y": year}).first()

    # Quietest hour (with at least some crashes so it's meaningful)
    quiet_hour = db.execute(text("""
        SELECT crash_hour, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
          AND crash_hour IS NOT NULL
        GROUP BY crash_hour ORDER BY cnt ASC LIMIT 1
    """), {"c": county_code, "y": year}).first()

    # Top 3 causes
    cause_rows = db.execute(text("""
        SELECT canonical_cause, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
          AND canonical_cause IS NOT NULL
        GROUP BY canonical_cause ORDER BY cnt DESC LIMIT 5
    """), {"c": county_code, "y": year}).all()

    # DUI
    dui_count = db.execute(text(
        "SELECT COUNT(*) FROM crashes WHERE county_code = :c AND crash_year = :y AND canonical_cause = 'dui'"
    ), {"c": county_code, "y": year}).scalar() or 0

    # State totals for comparison
    state = db.execute(text("""
        SELECT COUNT(*) AS total,
               COALESCE(SUM(number_killed), 0) AS killed
        FROM crashes WHERE crash_year = :y
    """), {"y": year}).one()

    state_dui = db.execute(text(
        "SELECT COUNT(*) FROM crashes WHERE crash_year = :y AND canonical_cause = 'dui'"
    ), {"y": year}).scalar() or 0

    # Population
    pop = db.execute(text(
        "SELECT population FROM counties WHERE code = :c"
    ), {"c": county_code}).scalar()

    # Historical extremes (exclude current partial year)
    hist = db.execute(text("""
        SELECT crash_year, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c
          AND crash_year < EXTRACT(year FROM CURRENT_DATE)
        GROUP BY crash_year HAVING COUNT(*) >= 50
        ORDER BY crash_year
    """), {"c": county_code}).all()
    hist_list = [(r.crash_year, r.cnt) for r in hist]

    # YoY
    prior = db.execute(text(
        "SELECT COUNT(*) FROM crashes WHERE county_code = :c AND crash_year = :y"
    ), {"c": county_code, "y": year - 1}).scalar() or 0

    # County rank by crash count this year
    rank_row = db.execute(text("""
        SELECT rank FROM (
            SELECT county_code, RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
            FROM crashes WHERE crash_year = :y
            GROUP BY county_code
        ) sub WHERE county_code = :c
    """), {"c": county_code, "y": year}).first()

    # Crashes per day
    crashes_per_day = round(tc / 365, 1)

    return {
        "tc": tc, "tk": tk, "ti": ti,
        "fatality_rate": round(tk / tc * 100, 2) if tc > 0 else 0,
        "dow": dow,
        "months": months,
        "peak_hour": (hour_row.crash_hour, hour_row.cnt) if hour_row else None,
        "quiet_hour": (quiet_hour.crash_hour, quiet_hour.cnt) if quiet_hour else None,
        "causes": [(r.canonical_cause, r.cnt) for r in cause_rows] if cause_rows else [],
        "dui_count": dui_count,
        "dui_pct": round(dui_count / tc * 100, 1) if tc > 0 else 0,
        "state_total": state.total,
        "state_killed": state.killed,
        "state_fatality_rate": round(state.killed / state.total * 100, 2) if state.total > 0 else 0,
        "state_dui_pct": round(state_dui / state.total * 100, 1) if state.total > 0 else 0,
        "county_share": round(tc / state.total * 100, 2) if state.total > 0 else 0,
        "pop": pop,
        "per_capita": round(tc / pop * 100_000, 0) if pop and pop > 0 else None,
        "hist": hist_list,
        "yoy": round(((tc - prior) / prior) * 100, 1) if prior > 0 else None,
        "rank": rank_row.rank if rank_row else None,
        "crashes_per_day": crashes_per_day,
        "year": year,
    }


# ---------------------------------------------------------------------------
# County fun-fact composers
# ---------------------------------------------------------------------------

def _compose_timing(name: str, s: dict) -> str:
    parts = []

    # Day of week angle
    if s["dow"]:
        busiest_d = max(s["dow"], key=s["dow"].get)
        quietest_d = min(s["dow"], key=s["dow"].get)
        spread = round((s["dow"][busiest_d] - s["dow"][quietest_d]) / s["dow"][quietest_d] * 100)
        parts.append(
            f"{DOW_NAMES[busiest_d]} is the most crash-prone day in {name} County, "
            f"with {_fmt(s['dow'][busiest_d])} collisions — {spread}% more than "
            f"{DOW_NAMES[quietest_d]}s, which are the quietest."
        )

    # Peak vs quiet hour
    if s["peak_hour"] and s["quiet_hour"]:
        ph, pc = s["peak_hour"]
        qh, qc = s["quiet_hour"]
        ratio = round(pc / qc, 1) if qc > 0 else 0
        parts.append(
            f"The single most dangerous hour is {_hour_label(ph)}, which sees "
            f"{ratio}x as many crashes as {_hour_label(qh)}, the calmest hour on the road."
        )

    # Month angle
    if s["months"]:
        busiest_m = max(s["months"], key=s["months"].get)
        quietest_m = min(s["months"], key=s["months"].get)
        parts.append(
            f"{MONTH_NAMES[busiest_m]} leads the year with {_fmt(s['months'][busiest_m])} crashes, "
            f"while {MONTH_NAMES[quietest_m]} is the safest month at {_fmt(s['months'][quietest_m])}."
        )

    return " ".join(parts[:2])


def _compose_comparison(name: str, s: dict) -> str:
    parts = []

    # Share of state
    if s["county_share"] and s["pop"] and s["state_total"]:
        # Rough CA population ~39M
        pop_share = round(s["pop"] / 39_000_000 * 100, 1)
        if abs(s["county_share"] - pop_share) > 0.3:
            direction = "more" if s["county_share"] > pop_share else "fewer"
            parts.append(
                f"{name} County holds {pop_share}% of California's population but "
                f"accounts for {s['county_share']}% of its crashes — proportionally "
                f"{direction} than its population share would suggest."
            )

    # Fatality rate comparison
    if s["fatality_rate"] and s["state_fatality_rate"]:
        diff = s["fatality_rate"] - s["state_fatality_rate"]
        if abs(diff) > 0.1:
            ratio = round(s["fatality_rate"] / s["state_fatality_rate"], 1) if s["state_fatality_rate"] > 0 else 0
            if ratio >= 1.5:
                parts.append(
                    f"With a fatality rate of {s['fatality_rate']}% (vs. the state's "
                    f"{s['state_fatality_rate']}%), crashes here are {ratio}x more "
                    f"likely to be fatal than the California average."
                )
            elif ratio <= 0.7:
                parts.append(
                    f"The county's fatality rate of {s['fatality_rate']}% is well below "
                    f"the statewide {s['state_fatality_rate']}%, meaning crashes here "
                    f"are less likely to be deadly — likely thanks to lower speeds and "
                    f"better infrastructure."
                )

    # DUI comparison
    if s["dui_pct"] and s["state_dui_pct"]:
        diff = s["dui_pct"] - s["state_dui_pct"]
        if abs(diff) > 1.5:
            direction = "above" if diff > 0 else "below"
            parts.append(
                f"DUI-involved crashes make up {s['dui_pct']}% of all collisions here, "
                f"{abs(diff):.1f} percentage points {direction} the state average of "
                f"{s['state_dui_pct']}%."
            )

    # Rank
    if s["rank"]:
        ordinal = {1: "1st", 2: "2nd", 3: "3rd"}.get(s["rank"], f"{s['rank']}th")
        parts.append(
            f"By sheer volume, {name} ranks {ordinal} out of 58 California "
            f"counties with {_fmt(s['tc'])} crashes."
        )

    return " ".join(parts[:2]) if parts else (
        f"{name} County recorded {_fmt(s['tc'])} crashes, accounting for "
        f"{s['county_share']}% of California's total."
    )


def _compose_quirky(name: str, s: dict) -> str:
    options = []

    # Crashes per day
    if s["crashes_per_day"] >= 10:
        options.append(
            f"On average, a crash happens in {name} County every "
            f"{round(24 * 60 / (s['tc'] / 365))} minutes — that's "
            f"roughly {s['crashes_per_day']} collisions per day, or one every time "
            f"you'd finish a coffee break."
        )
    elif s["crashes_per_day"] < 1:
        gap = round(365 / s["tc"], 1)
        options.append(
            f"With only {_fmt(s['tc'])} crashes all year, {name} County averages "
            f"one collision every {gap} days. You're statistically more likely to "
            f"see a bear than a fender-bender here."
        )
    else:
        options.append(
            f"{name} County averages about {s['crashes_per_day']} crashes per day — "
            f"roughly one every {round(24 / s['crashes_per_day'])} hours around the clock."
        )

    # Dominant cause
    if s["causes"]:
        top_cause, top_cnt = s["causes"][0]
        top_pct = round(top_cnt / s["tc"] * 100, 1)
        if top_pct > 35:
            options.append(
                f"A single cause dominates here: \"{top_cause}\" is behind {top_pct}% "
                f"of all crashes in {name} County — more than the next "
                f"{len(s['causes']) - 1} causes combined."
            )

    # Injury-to-fatality ratio
    if s["tk"] > 0 and s["ti"] > 0:
        ratio = round(s["ti"] / s["tk"])
        options.append(
            f"For every person killed on {name} County roads, another {ratio} are "
            f"injured. That {ratio}-to-1 ratio {'is higher than' if ratio > 150 else 'falls below' if ratio < 50 else 'tracks close to'} "
            f"the statewide pattern."
        )

    # Historical swing
    if len(s["hist"]) >= 5:
        peak = max(s["hist"], key=lambda x: x[1])
        low = min(s["hist"], key=lambda x: x[1])
        if peak[1] > low[1] * 1.5:
            pct_drop = round((1 - low[1] / peak[1]) * 100)
            options.append(
                f"The county's crash count has swung dramatically — from a peak of "
                f"{_fmt(peak[1])} in {peak[0]} down to {_fmt(low[1])} in {low[0]}, "
                f"a {pct_drop}% drop. {'The pandemic year likely played a role.' if low[0] == 2020 else ''}"
            )

    # Pick the most interesting 1-2. MD5 here only maps a county name to a
    # stable integer seed so the same county always shows the same facts — it
    # is not used for security/integrity, so the weak-hash warning is a false
    # positive on this line.
    random.seed(int(hashlib.md5(name.encode()).hexdigest(), 16))  # nosec B324
    random.shuffle(options)
    return " ".join(options[:2]) if options else (
        f"{name} County saw {_fmt(s['tc'])} crashes and {_fmt(s['tk'])} fatalities — "
        f"a fatality rate of {s['fatality_rate']}%."
    )


# ---------------------------------------------------------------------------
# Statewide stat queries
# ---------------------------------------------------------------------------

def _query_statewide_stats(db: Session, year: int) -> dict | None:
    totals = db.execute(text("""
        SELECT COUNT(*) AS total_crashes,
               COALESCE(SUM(number_killed), 0) AS total_killed,
               COALESCE(SUM(number_injured), 0) AS total_injured
        FROM crashes WHERE crash_year = :y
    """), {"y": year}).one()

    if totals.total_crashes == 0:
        return None

    tc = totals.total_crashes
    tk = totals.total_killed
    ti = totals.total_injured

    # Top county
    top_county = db.execute(text("""
        SELECT c.name, COUNT(*) AS cnt
        FROM crashes cr JOIN counties c ON cr.county_code = c.code
        WHERE cr.crash_year = :y GROUP BY c.name ORDER BY cnt DESC LIMIT 1
    """), {"y": year}).first()

    # Smallest county with crashes
    small_county = db.execute(text("""
        SELECT c.name, COUNT(*) AS cnt
        FROM crashes cr JOIN counties c ON cr.county_code = c.code
        WHERE cr.crash_year = :y GROUP BY c.name
        HAVING COUNT(*) >= 10 ORDER BY cnt ASC LIMIT 1
    """), {"y": year}).first()

    # Highest fatality rate (min 100 crashes)
    high_fat = db.execute(text("""
        SELECT c.name, COUNT(*) AS cnt,
               SUM(cr.number_killed) AS killed,
               ROUND(SUM(cr.number_killed)::numeric / COUNT(*) * 100, 2) AS rate
        FROM crashes cr JOIN counties c ON cr.county_code = c.code
        WHERE cr.crash_year = :y GROUP BY c.name
        HAVING COUNT(*) >= 100 ORDER BY rate DESC LIMIT 1
    """), {"y": year}).first()

    # Lowest fatality rate (min 500 crashes)
    low_fat = db.execute(text("""
        SELECT c.name, COUNT(*) AS cnt,
               ROUND(SUM(cr.number_killed)::numeric / COUNT(*) * 100, 2) AS rate
        FROM crashes cr JOIN counties c ON cr.county_code = c.code
        WHERE cr.crash_year = :y GROUP BY c.name
        HAVING COUNT(*) >= 500 ORDER BY rate ASC LIMIT 1
    """), {"y": year}).first()

    # Top cause
    top_cause = db.execute(text("""
        SELECT canonical_cause, COUNT(*) AS cnt
        FROM crashes WHERE crash_year = :y AND canonical_cause IS NOT NULL
        GROUP BY canonical_cause ORDER BY cnt DESC LIMIT 1
    """), {"y": year}).first()

    # DUI
    dui_count = db.execute(text(
        "SELECT COUNT(*) FROM crashes WHERE crash_year = :y AND canonical_cause = 'dui'"
    ), {"y": year}).scalar() or 0

    # Highest DUI county (min 200 crashes)
    high_dui = db.execute(text("""
        SELECT c.name,
               ROUND(SUM(CASE WHEN cr.canonical_cause = 'dui' THEN 1 ELSE 0 END)::numeric
                     / COUNT(*) * 100, 1) AS dui_pct
        FROM crashes cr JOIN counties c ON cr.county_code = c.code
        WHERE cr.crash_year = :y GROUP BY c.name
        HAVING COUNT(*) >= 200 ORDER BY dui_pct DESC LIMIT 1
    """), {"y": year}).first()

    # Peak hour
    peak_hour = db.execute(text("""
        SELECT crash_hour, COUNT(*) AS cnt
        FROM crashes WHERE crash_year = :y AND crash_hour IS NOT NULL
        GROUP BY crash_hour ORDER BY cnt DESC LIMIT 1
    """), {"y": year}).first()

    # Day of week
    dow_rows = db.execute(text("""
        SELECT day_of_week_num, COUNT(*) AS cnt
        FROM crashes WHERE crash_year = :y AND day_of_week_num IS NOT NULL
        GROUP BY day_of_week_num ORDER BY cnt DESC
    """), {"y": year}).all()

    # Prior year
    prior = db.execute(text(
        "SELECT COUNT(*) FROM crashes WHERE crash_year = :y"
    ), {"y": year - 1}).scalar() or 0
    yoy = round(((tc - prior) / prior) * 100, 1) if prior > 0 else None

    crashes_per_day = round(tc / 365, 1)

    return {
        "tc": tc, "tk": tk, "ti": ti, "year": year,
        "fatality_rate": round(tk / tc * 100, 2),
        "crashes_per_day": crashes_per_day,
        "top_county": (top_county.name, top_county.cnt) if top_county else None,
        "small_county": (small_county.name, small_county.cnt) if small_county else None,
        "high_fat": (high_fat.name, float(high_fat.rate), high_fat.killed) if high_fat else None,
        "low_fat": (low_fat.name, float(low_fat.rate)) if low_fat else None,
        "top_cause": (top_cause.canonical_cause, top_cause.cnt) if top_cause else None,
        "dui_count": dui_count,
        "dui_pct": round(dui_count / tc * 100, 1),
        "high_dui": (high_dui.name, float(high_dui.dui_pct)) if high_dui else None,
        "peak_hour": (peak_hour.crash_hour, peak_hour.cnt) if peak_hour else None,
        "dow": {r.day_of_week_num: r.cnt for r in dow_rows} if dow_rows else {},
        "yoy": yoy,
    }


# ---------------------------------------------------------------------------
# Statewide fun-fact composers
# ---------------------------------------------------------------------------

def _compose_statewide_fun_fact(s: dict) -> str:
    parts = []
    minutes_between = 365 * 24 * 60 / s["tc"] if s["tc"] > 0 else 0
    if minutes_between >= 2:
        interval_str = f"every {round(minutes_between)} minutes"
    elif minutes_between >= 1:
        seconds = round(minutes_between * 60)
        interval_str = f"every {seconds} seconds"
    else:
        seconds = round(minutes_between * 60)
        interval_str = f"every {seconds} seconds"
    if minutes_between > 0:
        parts.append(
            f"California averaged one crash {interval_str} in "
            f"{s['year']} — {_fmt(s['crashes_per_day'])} collisions per day, "
            f"{_fmt(s['tc'])} for the year."
        )
    if s["top_county"]:
        share = round(s["top_county"][1] / s["tc"] * 100, 1)
        parts.append(
            f"{s['top_county'][0]} County alone accounted for {share}% of all "
            f"crashes statewide, logging {_fmt(s['top_county'][1])} collisions."
        )
    return " ".join(parts[:2])


def _compose_statewide_records(s: dict) -> str:
    parts = []
    if s["high_fat"]:
        parts.append(
            f"{s['high_fat'][0]} County had the highest fatality rate at "
            f"{s['high_fat'][1]}% — meaning roughly 1 in "
            f"{round(100 / s['high_fat'][1]) if s['high_fat'][1] > 0 else '?'} "
            f"crashes there was fatal, compared to 1 in "
            f"{round(100 / s['fatality_rate']) if s['fatality_rate'] > 0 else '?'} statewide."
        )
    if s["low_fat"]:
        parts.append(
            f"On the other end, {s['low_fat'][0]} County's fatality rate of "
            f"{s['low_fat'][1]}% made it one of the safest places to have "
            f"a crash in California."
        )
    if s["high_dui"]:
        parts.append(
            f"{s['high_dui'][0]} County led the state in DUI-involved crashes "
            f"at {s['high_dui'][1]}% of all collisions."
        )
    return " ".join(parts[:2]) if parts else (
        f"California recorded {_fmt(s['tc'])} crashes in {s['year']}."
    )


def _compose_statewide_surprising(s: dict) -> str:
    parts = []

    # Peak hour surprise
    if s["peak_hour"]:
        h, cnt = s["peak_hour"]
        pct = round(cnt / s["tc"] * 100, 1)
        if 15 <= h <= 18:
            parts.append(
                f"The evening commute is as dangerous as you'd expect: "
                f"{_hour_label(h)} is California's deadliest hour, concentrating "
                f"{pct}% of the day's crashes into a single 60-minute window."
            )
        else:
            parts.append(
                f"Forget rush hour — the most crash-prone time in California "
                f"is actually {_hour_label(h)}, which accounted for {pct}% "
                f"of all {s['year']} collisions."
            )

    # DUI surprise
    if s["dui_pct"] < 8:
        parts.append(
            f"Despite the attention it gets, DUI accounts for just "
            f"{s['dui_pct']}% of California crashes. The real villain? "
            f"\"{s['top_cause'][0]}\" at "
            f"{round(s['top_cause'][1] / s['tc'] * 100, 1)}%."
            if s["top_cause"] else ""
        )
    elif s["dui_pct"] > 10:
        parts.append(
            f"Alcohol-involved crashes hit {s['dui_pct']}% of all collisions "
            f"in {s['year']} — that's {_fmt(s['dui_count'])} DUI crashes, or "
            f"roughly {round(s['dui_count'] / 365)} every single day."
        )

    # YoY surprise
    if s["yoy"] is not None and abs(s["yoy"]) > 5:
        direction = "jumped" if s["yoy"] > 0 else "dropped"
        parts.append(
            f"Crash volume {direction} {abs(s['yoy'])}% compared to the prior "
            f"year{' — pandemic-era driving patterns likely played a role' if s['year'] in (2020, 2021) else ''}."
        )

    return " ".join(parts[:2]) if parts else (
        f"California's {_fmt(s['tc'])} crashes in {s['year']} resulted in "
        f"{_fmt(s['tk'])} fatalities — a rate of {s['fatality_rate']}%."
    )


# ---------------------------------------------------------------------------
# Main generation
# ---------------------------------------------------------------------------

COUNTY_ANGLES = {
    "fun_fact_timing": _compose_timing,
    "fun_fact_comparison": _compose_comparison,
    "fun_fact_quirky": _compose_quirky,
}

STATEWIDE_ANGLES = {
    "fun_fact": _compose_statewide_fun_fact,
    "fun_fact_records": _compose_statewide_records,
    "fun_fact_surprising": _compose_statewide_surprising,
}


def _generate_county(db: Session) -> int:
    counties: list[County] = db.query(County).order_by(County.name).all()
    created = 0
    skipped = 0

    for county in counties:
        year = db.execute(text("""
            SELECT crash_year FROM crashes
            WHERE county_code = :c
              AND crash_year < EXTRACT(year FROM CURRENT_DATE)
            GROUP BY crash_year HAVING COUNT(*) >= 50
            ORDER BY crash_year DESC LIMIT 1
        """), {"c": county.code}).scalar()

        if year is None:
            continue

        stats = _query_county_stats(db, county.code, year)
        if stats is None:
            continue

        for angle, composer in COUNTY_ANGLES.items():
            existing = (
                db.query(CountyInsightCard)
                .filter_by(county_code=county.code, year=year, angle=angle)
                .first()
            )
            if existing:
                skipped += 1
                continue

            narrative = composer(county.name, stats)
            if not narrative or len(narrative) < 20:
                logger.warning("Skipping %s/%s — narrative too short", county.name, angle)
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
            logger.info("[county] %s / %s — done", county.name, angle)

    logger.info("County fun facts: %d created, %d skipped", created, skipped)
    return created


def _generate_statewide(db: Session) -> int:
    years = [
        r[0] for r in db.execute(text("""
            SELECT crash_year FROM crashes
            GROUP BY crash_year HAVING COUNT(*) >= 1000
            ORDER BY crash_year
        """)).all()
    ]

    created = 0
    skipped = 0

    for year in years:
        stats = _query_statewide_stats(db, year)
        if stats is None:
            continue

        for angle, composer in STATEWIDE_ANGLES.items():
            existing = (
                db.query(StatewideInsight)
                .filter_by(year=year, angle=angle)
                .first()
            )
            if existing:
                skipped += 1
                continue

            narrative = composer(stats)
            if not narrative or len(narrative) < 20:
                continue

            stmt = (
                pg_insert(StatewideInsight)
                .values(year=year, angle=angle, narrative=narrative, data_source="switrs")
                .on_conflict_do_update(
                    index_elements=["year", "angle"],
                    set_=dict(narrative=narrative),
                )
            )
            db.execute(stmt)
            db.commit()
            created += 1
            logger.info("[statewide] %s / %d — done", angle, year)

    logger.info("Statewide fun facts: %d created, %d skipped", created, skipped)
    return created


def run(mode: str = "all") -> int:
    db = SessionLocal()
    try:
        total = 0
        if mode in ("all", "county"):
            total += _generate_county(db)
        if mode in ("all", "statewide"):
            total += _generate_statewide(db)
        return total
    finally:
        db.close()


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    total = run(mode)
    print(f"\nDone — {total} fun-fact cards generated.")
