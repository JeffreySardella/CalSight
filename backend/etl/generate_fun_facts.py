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
    python -m etl.generate_fun_facts --force       # rewrite existing (the daily `fun_facts` job)

Every fact passes etl.fact_check before it is written: no figure that isn't
in the stats, no causal language, no current (partial) year.
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
from etl.fact_check import check_fact, numbers_context

logger = logging.getLogger(__name__)


def fact_fails(label: str, narrative: str, context: str, year: int) -> bool:
    """Run the write-time fact check; log and return True when it fails."""
    reasons = check_fact(narrative, context, year)
    if reasons:
        logger.warning("Not writing %s — %s", label, "; ".join(reasons))
    return bool(reasons)

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
        "deaths_per_1k": round(tk / tc * 1000, 1) if tc > 0 else 0,
        "dow": dow,
        "months": months,
        "peak_hour": (hour_row.crash_hour, hour_row.cnt) if hour_row else None,
        "quiet_hour": (quiet_hour.crash_hour, quiet_hour.cnt) if quiet_hour else None,
        "causes": [(r.canonical_cause, r.cnt) for r in cause_rows] if cause_rows else [],
        "dui_count": dui_count,
        "dui_pct": round(dui_count / tc * 100, 1) if tc > 0 else 0,
        "state_total": state.total,
        "state_killed": state.killed,
        "state_deaths_per_1k": round(state.killed / state.total * 1000, 1) if state.total > 0 else 0,
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

    # Deaths per 1,000 crashes — the one unit the site uses for this rate
    if s["deaths_per_1k"] and s["state_deaths_per_1k"]:
        diff = s["deaths_per_1k"] - s["state_deaths_per_1k"]
        if abs(diff) > 1:
            ratio = round(s["deaths_per_1k"] / s["state_deaths_per_1k"], 1) if s["state_deaths_per_1k"] > 0 else 0
            if ratio >= 1.5:
                parts.append(
                    f"With {s['deaths_per_1k']} deaths per 1,000 crashes (vs. the state's "
                    f"{s['state_deaths_per_1k']}), crashes here are {ratio}x more "
                    f"likely to be fatal than the California average."
                )
            elif ratio <= 0.7:
                parts.append(
                    f"The county's {s['deaths_per_1k']} deaths per 1,000 crashes is well below "
                    f"the statewide {s['state_deaths_per_1k']}, meaning crashes here "
                    f"are less likely to be deadly than the California average."
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
            f"On average, a crash happens in {name} County "
            f"{_interval_phrase(24 * 60 / (s['tc'] / 365))} — that's "
            f"roughly {s['crashes_per_day']} collisions per day, or one every time "
            f"you'd finish a coffee break."
        )
    elif s["crashes_per_day"] < 1:
        gap = round(365 / s["tc"], 1)
        options.append(
            f"With only {_fmt(s['tc'])} crashes all year, {name} County averages "
            f"one collision every {gap} days."
        )
    else:
        options.append(
            f"{name} County averages about {s['crashes_per_day']} crashes per day — "
            f"roughly one every {round(24 / s['crashes_per_day'])} hours around the clock."
        )

    # Dominant primary collision factor
    if s["causes"]:
        top_cause, top_cnt = s["causes"][0]
        top_pct = round(top_cnt / s["tc"] * 100, 1)
        rest = s["causes"][1:]
        if top_pct > 35:
            options.append(
                f"One factor dominates here: \"{top_cause}\" is the primary collision "
                f"factor in {top_pct}% of all crashes in {name} County"
                + (
                    f" — more than the next {len(rest)} factors combined."
                    if rest and top_cnt > sum(c for _, c in rest) else "."
                )
            )

    # Injury-to-fatality ratio
    if s["tk"] > 0 and s["ti"] > 0:
        ratio = round(s["ti"] / s["tk"])
        options.append(
            f"For every person killed on {name} County roads, another {ratio} were "
            f"injured."
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
                f"a {pct_drop}% drop."
            )

    # Pick the most interesting 1-2. MD5 here only maps a county name to a
    # stable integer seed so the same county always shows the same facts — it
    # is not used for security/integrity, so the weak-hash warning is a false
    # positive on this line.
    random.seed(int(hashlib.md5(name.encode()).hexdigest(), 16))  # nosec B324
    random.shuffle(options)
    return " ".join(options[:2]) if options else (
        f"{name} County saw {_fmt(s['tc'])} crashes and {_fmt(s['tk'])} fatalities — "
        f"{s['deaths_per_1k']} deaths per 1,000 crashes."
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

    # Highest deaths per 1,000 crashes (min 100 crashes)
    high_fat = db.execute(text("""
        SELECT c.name, COUNT(*) AS cnt,
               SUM(cr.number_killed) AS killed,
               ROUND(SUM(cr.number_killed)::numeric / COUNT(*) * 1000, 1) AS rate
        FROM crashes cr JOIN counties c ON cr.county_code = c.code
        WHERE cr.crash_year = :y GROUP BY c.name
        HAVING COUNT(*) >= 100 ORDER BY rate DESC LIMIT 1
    """), {"y": year}).first()

    # Lowest deaths per 1,000 crashes (min 500 crashes)
    low_fat = db.execute(text("""
        SELECT c.name, COUNT(*) AS cnt,
               ROUND(SUM(cr.number_killed)::numeric / COUNT(*) * 1000, 1) AS rate
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
        "deaths_per_1k": round(tk / tc * 1000, 1),
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

def _interval_phrase(minutes: float) -> str:
    """'every 3 minutes' or 'every 108 seconds' — never 'every 1 minutes'.

    Statewide (~450k crashes/yr) and Los Angeles both land between one and two
    minutes per crash, and rounding that to whole minutes shipped the
    ungrammatical "one crash every 1 minutes" on the live /api/fun-facts.
    """
    if minutes >= 2:
        return f"every {round(minutes)} minutes"
    return f"every {round(minutes * 60)} seconds"


def _compose_statewide_fun_fact(s: dict) -> str:
    parts = []
    minutes_between = 365 * 24 * 60 / s["tc"] if s["tc"] > 0 else 0
    if minutes_between > 0:
        parts.append(
            f"California averaged one crash {_interval_phrase(minutes_between)} in "
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
            f"{s['high_fat'][0]} County had the highest death rate at "
            f"{s['high_fat'][1]} deaths per 1,000 crashes — roughly one death for every "
            f"{round(1000 / s['high_fat'][1]) if s['high_fat'][1] > 0 else '?'} "
            f"crashes, compared to one for every "
            f"{round(1000 / s['deaths_per_1k']) if s['deaths_per_1k'] > 0 else '?'} statewide."
        )
    if s["low_fat"]:
        parts.append(
            f"On the other end, {s['low_fat'][0]} County's "
            f"{s['low_fat'][1]} deaths per 1,000 crashes made it one of the safest places to have "
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
                f"{_hour_label(h)} is California's most crash-prone hour, concentrating "
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
            f"DUI accounts for {s['dui_pct']}% of California crashes, while the "
            f"most common primary factor, \"{s['top_cause'][0]}\", accounts for "
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
            f"Crash volume {direction} {abs(s['yoy'])}% in {s['year']} compared "
            f"to the prior year."
        )

    return " ".join(parts[:2]) if parts else (
        f"California recorded {_fmt(s['tc'])} crashes and {_fmt(s['tk'])} "
        f"fatalities in {s['year']} — {s['deaths_per_1k']} deaths per 1,000 crashes."
    )


def fact_context(s: dict) -> str:
    """Every figure a fun fact built from ``s`` may state, for etl.fact_check.

    The raw stats plus the handful of figures the composers above derive
    (shares, ratios, intervals). Covers both the county and statewide dicts.
    """
    tc, tk, ti = s["tc"], s["tk"], s["ti"]
    derived: list[float] = [60, 31_536_000 / tc, 365 / tc]  # 60-minute window; seconds/days between
    if tk:
        derived += [ti / tk, 1000 / s["deaths_per_1k"]] if s["deaths_per_1k"] else [ti / tk]
    if s.get("crashes_per_day"):
        derived.append(24 / s["crashes_per_day"])
    counted = [s.get("peak_hour"), s.get("top_cause"), s.get("top_county"), *s.get("causes", [])]
    derived += [c[1] / tc * 100 for c in counted if c]
    if s.get("dow"):
        hi, lo = max(s["dow"].values()), min(s["dow"].values())
        if lo:
            derived.append((hi - lo) / lo * 100)
    if s.get("peak_hour") and s.get("quiet_hour") and s["quiet_hour"][1]:
        derived.append(s["peak_hour"][1] / s["quiet_hour"][1])
    if s.get("pop"):
        derived.append(s["pop"] / 39_000_000 * 100)
    if s.get("state_dui_pct") is not None:
        derived.append(s["dui_pct"] - s["state_dui_pct"])
    if s.get("hist"):
        peak, low = max(c for _, c in s["hist"]), min(c for _, c in s["hist"])
        derived.append((1 - low / peak) * 100)
    if s.get("high_fat") and s["high_fat"][1]:
        derived.append(1000 / s["high_fat"][1])
    if s.get("dui_count"):
        derived.append(s["dui_count"] / 365)
    return (
        f"total_crashes={tc}, killed={tk}, injured={ti}, "
        + numbers_context(s, derived)
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


def _generate_county(db: Session, force: bool = False) -> int:
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
        context = fact_context(stats)

        for angle, composer in COUNTY_ANGLES.items():
            existing = (
                db.query(CountyInsightCard)
                .filter_by(county_code=county.code, year=year, angle=angle)
                .first()
            )
            if existing and not force:
                skipped += 1
                continue

            narrative = composer(county.name, stats)
            if not narrative or len(narrative) < 20:
                logger.warning("Skipping %s/%s — narrative too short", county.name, angle)
                continue
            if fact_fails(f"{county.name}/{year}/{angle}", narrative, context, year):
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


def _generate_statewide(db: Session, force: bool = False) -> int:
    years = [
        r[0] for r in db.execute(text("""
            SELECT crash_year FROM crashes
            WHERE crash_year < EXTRACT(year FROM CURRENT_DATE)
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
        context = fact_context(stats)

        for angle, composer in STATEWIDE_ANGLES.items():
            existing = (
                db.query(StatewideInsight)
                .filter_by(year=year, angle=angle)
                .first()
            )
            if existing and not force:
                skipped += 1
                continue

            narrative = composer(stats)
            if not narrative or len(narrative) < 20:
                continue
            if fact_fails(f"statewide/{year}/{angle}", narrative, context, year):
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


def run(mode: str = "all", force: bool = False) -> int:
    """Generate missing fun facts; with force=True, rewrite existing ones too.

    The composers are deterministic templates (no LLM), so a forced rerun is
    how a wording fix reaches rows already in the table — the 2026-09-12
    "one crash every 1 minutes" text would otherwise have lived forever.
    """
    db = SessionLocal()
    try:
        total = 0
        if mode in ("all", "county"):
            total += _generate_county(db, force=force)
        if mode in ("all", "statewide"):
            total += _generate_statewide(db, force=force)
        return total
    finally:
        db.close()


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    # usage: python -m etl.generate_fun_facts [all|county|statewide] [--force]
    force = "--force" in sys.argv
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    mode = positional[0] if positional else "all"
    total = run(mode, force=force)
    print(f"\nDone — {total} fun-fact cards generated.")
