"""Generate high-quality county insight cards for multiple angles.

Fills sparse angles (unique_factor, comparison, cause_focus, dui,
safety_ranking, geography, seasonal) with data-driven analysis.
Skips counties that already have a card for a given angle.

Usage::

    cd backend
    python -m etl.generate_county_cards
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, CountyInsightCard

logger = logging.getLogger(__name__)

MONTH_NAMES = {1: "January", 2: "February", 3: "March", 4: "April",
               5: "May", 6: "June", 7: "July", 8: "August",
               9: "September", 10: "October", 11: "November", 12: "December"}
DOW_NAMES = {0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
             4: "Thursday", 5: "Friday", 6: "Saturday"}


def _fmt(n: int | float) -> str:
    if isinstance(n, float):
        return f"{n:,.1f}"
    return f"{n:,}"


def _ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{['th','st','nd','rd','th','th','th','th','th','th'][n%10]}"


def _hour_label(h: int) -> str:
    if h == 0:
        return "midnight"
    if h == 12:
        return "noon"
    return f"{h % 12} {'AM' if h < 12 else 'PM'}"


# ---------------------------------------------------------------------------
# Full county data query
# ---------------------------------------------------------------------------

def _query_full(db: Session, county_code: int, year: int) -> dict | None:
    t = db.execute(text("""
        SELECT COUNT(*) AS tc,
               COALESCE(SUM(number_killed),0) AS tk,
               COALESCE(SUM(number_injured),0) AS ti
        FROM crashes WHERE county_code = :c AND crash_year = :y
    """), {"c": county_code, "y": year}).one()
    if t.tc == 0:
        return None

    tc, tk, ti = t.tc, t.tk, t.ti

    # All causes
    causes = db.execute(text("""
        SELECT canonical_cause, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y
          AND canonical_cause IS NOT NULL
        GROUP BY canonical_cause ORDER BY cnt DESC
    """), {"c": county_code, "y": year}).all()

    # DUI
    dui = next((r.cnt for r in causes if r.canonical_cause == "dui"), 0)

    # Severity breakdown
    sev = db.execute(text("""
        SELECT severity, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND severity IS NOT NULL
        GROUP BY severity ORDER BY cnt DESC
    """), {"c": county_code, "y": year}).all()
    sev_map = {r.severity: r.cnt for r in sev}

    # Peak hour
    peak_h = db.execute(text("""
        SELECT crash_hour, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND crash_hour IS NOT NULL
        GROUP BY crash_hour ORDER BY cnt DESC LIMIT 1
    """), {"c": county_code, "y": year}).first()

    # Month breakdown
    months = db.execute(text("""
        SELECT crash_month, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND crash_month IS NOT NULL
        GROUP BY crash_month ORDER BY cnt DESC
    """), {"c": county_code, "y": year}).all()

    # Day of week
    dow = db.execute(text("""
        SELECT day_of_week_num, COUNT(*) AS cnt
        FROM crashes WHERE county_code = :c AND crash_year = :y AND day_of_week_num IS NOT NULL
        GROUP BY day_of_week_num ORDER BY cnt DESC
    """), {"c": county_code, "y": year}).all()

    # Highway vs local
    hw = db.execute(text("""
        SELECT
            SUM(CASE WHEN is_highway THEN 1 ELSE 0 END) AS hw,
            SUM(CASE WHEN is_freeway THEN 1 ELSE 0 END) AS fw
        FROM crashes WHERE county_code = :c AND crash_year = :y
    """), {"c": county_code, "y": year}).one()

    # Pedestrian / cyclist
    ped = db.execute(text("""
        SELECT
            SUM(CASE WHEN pedestrian_involved THEN 1 ELSE 0 END) AS ped,
            SUM(CASE WHEN cyclist_involved THEN 1 ELSE 0 END) AS cyc
        FROM crashes WHERE county_code = :c AND crash_year = :y
    """), {"c": county_code, "y": year}).one()

    # Hit and run
    hr = db.execute(text("""
        SELECT COUNT(*) FROM crashes
        WHERE county_code = :c AND crash_year = :y AND hit_run IS NOT NULL
    """), {"c": county_code, "y": year}).scalar() or 0

    # Population + demographics
    pop = db.execute(text("SELECT population FROM counties WHERE code = :c"), {"c": county_code}).scalar()
    demo = db.execute(text("""
        SELECT population_density, median_income, poverty_rate,
               commute_drive_alone_pct
        FROM demographics WHERE county_code = :c AND year = :y LIMIT 1
    """), {"c": county_code, "y": year}).first()

    # State totals
    st = db.execute(text("""
        SELECT COUNT(*) AS tc,
               COALESCE(SUM(number_killed),0) AS tk,
               SUM(CASE WHEN canonical_cause='dui' THEN 1 ELSE 0 END) AS dui,
               SUM(CASE WHEN pedestrian_involved THEN 1 ELSE 0 END) AS ped,
               SUM(CASE WHEN cyclist_involved THEN 1 ELSE 0 END) AS cyc,
               SUM(CASE WHEN hit_run IS NOT NULL THEN 1 ELSE 0 END) AS hr
        FROM crashes WHERE crash_year = :y
    """), {"y": year}).one()

    # County rank
    rank = db.execute(text("""
        SELECT rank FROM (
            SELECT county_code, RANK() OVER (ORDER BY COUNT(*) DESC) AS rank
            FROM crashes WHERE crash_year = :y GROUP BY county_code
        ) sub WHERE county_code = :c
    """), {"c": county_code, "y": year}).first()

    # Fatality rank (min 100 crashes)
    fat_rank = db.execute(text("""
        SELECT rank FROM (
            SELECT county_code,
                   RANK() OVER (ORDER BY SUM(number_killed)::numeric/COUNT(*) DESC) AS rank
            FROM crashes WHERE crash_year = :y
            GROUP BY county_code HAVING COUNT(*) >= 100
        ) sub WHERE county_code = :c
    """), {"c": county_code, "y": year}).first()

    # Historical for context
    hist = db.execute(text("""
        SELECT crash_year, COUNT(*) AS cnt, SUM(number_killed) AS k
        FROM crashes WHERE county_code = :c
          AND crash_year < EXTRACT(year FROM CURRENT_DATE)
        GROUP BY crash_year HAVING COUNT(*) >= 20
        ORDER BY crash_year
    """), {"c": county_code}).all()

    return {
        "tc": tc, "tk": tk, "ti": ti,
        "fat_rate": round(tk / tc * 100, 2),
        "causes": [(r.canonical_cause, r.cnt, round(r.cnt/tc*100,1)) for r in causes],
        "dui": dui, "dui_pct": round(dui/tc*100, 1),
        "sev": sev_map,
        "fatal_count": sev_map.get("Fatal", 0),
        "pdo_count": sev_map.get("Property Damage Only", 0),
        "peak_hour": (peak_h.crash_hour, peak_h.cnt) if peak_h else None,
        "months": [(r.crash_month, r.cnt) for r in months],
        "dow": [(r.day_of_week_num, r.cnt) for r in dow],
        "hw_count": hw.hw or 0, "fw_count": hw.fw or 0,
        "hw_pct": round((hw.hw or 0)/tc*100, 1),
        "ped": ped.ped or 0, "cyc": ped.cyc or 0,
        "ped_pct": round((ped.ped or 0)/tc*100, 1),
        "cyc_pct": round((ped.cyc or 0)/tc*100, 1),
        "hr": hr, "hr_pct": round(hr/tc*100, 1),
        "pop": pop,
        "per_cap": round(tc/pop*100_000) if pop and pop > 0 else None,
        "density": demo.population_density if demo else None,
        "income": demo.median_income if demo else None,
        "poverty": demo.poverty_rate if demo else None,
        "commute_drive": demo.commute_drive_alone_pct if demo else None,
        "st_tc": st.tc, "st_tk": st.tk,
        "st_fat_rate": round(st.tk/st.tc*100, 2) if st.tc > 0 else 0,
        "st_dui_pct": round(st.dui/st.tc*100, 1) if st.tc > 0 else 0,
        "st_ped_pct": round(st.ped/st.tc*100, 1) if st.tc > 0 else 0,
        "st_cyc_pct": round(st.cyc/st.tc*100, 1) if st.tc > 0 else 0,
        "st_hr_pct": round(st.hr/st.tc*100, 1) if st.tc > 0 else 0,
        "county_share": round(tc/st.tc*100, 2) if st.tc > 0 else 0,
        "rank": rank.rank if rank else None,
        "fat_rank": fat_rank.rank if fat_rank else None,
        "hist": [(r.crash_year, r.cnt, r.k) for r in hist],
        "year": year,
    }


# ---------------------------------------------------------------------------
# Composers — each finds the most interesting story for its angle
# ---------------------------------------------------------------------------

def compose_unique_factor(name: str, d: dict) -> str:
    """What makes this county's crash profile distinctive."""
    findings = []

    # Unusually dominant cause
    if d["causes"] and d["causes"][0][2] > 35:
        c, cnt, pct = d["causes"][0]
        findings.append(
            f'"{c.replace("_", " ").title()}" dominates {name} County\'s crash profile at '
            f'{pct}% of all collisions — well above the typical distribution where no '
            f'single cause usually exceeds 30%.'
        )

    # Extremely high or low fatality rate vs state
    if d["fat_rate"] > d["st_fat_rate"] * 2 and d["tc"] >= 100:
        findings.append(
            f"Crashes in {name} County are {round(d['fat_rate']/d['st_fat_rate'],1)}x "
            f"more likely to be fatal than the state average — a {d['fat_rate']}% "
            f"fatality rate compared to California's {d['st_fat_rate']}%. Rural highways "
            f"with higher speeds and longer EMS response times are likely factors."
        )
    elif d["fat_rate"] < d["st_fat_rate"] * 0.5 and d["tc"] >= 500:
        findings.append(
            f"Despite high crash volume, {name} County's fatality rate of {d['fat_rate']}% "
            f"is less than half the state average of {d['st_fat_rate']}%. Dense urban "
            f"environments with lower speeds tend to produce fender-benders rather than "
            f"fatal collisions."
        )

    # Unusually high pedestrian rate
    if d["ped_pct"] > d["st_ped_pct"] * 1.5 and d["ped"] > 20:
        findings.append(
            f"Pedestrian-involved crashes make up {d['ped_pct']}% of collisions here — "
            f"significantly above the state's {d['st_ped_pct']}%. That's {_fmt(d['ped'])} "
            f"pedestrians struck in a single year."
        )

    # Unusually high highway proportion
    if d["hw_pct"] > 40:
        findings.append(
            f"A striking {d['hw_pct']}% of crashes occur on highways, reflecting "
            f"{name} County's role as a through-corridor where long-distance traffic "
            f"mixes with local driving."
        )

    # Very high hit-and-run rate
    if d["hr_pct"] > d["st_hr_pct"] * 1.3 and d["hr"] > 50:
        findings.append(
            f"Hit-and-run incidents are disproportionately common: {d['hr_pct']}% of "
            f"crashes involve a fleeing driver, compared to {d['st_hr_pct']}% statewide."
        )

    # Very low crash volume (rural character)
    if d["tc"] < 200 and d["pop"] and d["pop"] < 30000:
        per_day = round(d["tc"] / 365, 1)
        findings.append(
            f"With just {_fmt(d['tc'])} crashes all year — roughly {per_day} per day — "
            f"{name} is one of California's quietest counties for traffic incidents. "
            f"Its sparse population of {_fmt(d['pop'])} means roads are lightly traveled."
        )

    if findings:
        return " ".join(findings[:2])
    return (
        f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}, ranking "
        f"{_ordinal(d['rank'])} among California's 58 counties by volume."
    )


def compose_cause_focus(name: str, d: dict) -> str:
    """Deep dive into what's causing crashes."""
    if not d["causes"]:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."

    top3 = d["causes"][:3]
    top_cause, top_cnt, top_pct = top3[0]
    top_label = top_cause.replace("_", " ")

    parts = []

    # Lead with dominant cause
    if len(top3) >= 2:
        second = top3[1]
        gap = top_pct - second[2]
        if gap > 10:
            parts.append(
                f'The leading cause of crashes in {name} County is "{top_label}" at '
                f"{top_pct}%, a full {gap:.0f} percentage points ahead of "
                f'"{second[0].replace("_", " ")}" ({second[2]}%). '
                f"That concentration suggests a systemic issue rather than random variation."
            )
        else:
            parts.append(
                f'"{top_label.title()}" and "{second[0].replace("_", " ").title()}" '
                f"are nearly tied as the top crash causes in {name} County at "
                f"{top_pct}% and {second[2]}% respectively — together accounting for "
                f"more than half of all collisions."
            )

    # DUI context
    if d["dui_pct"] > 10:
        parts.append(
            f"DUI crashes are notably high at {d['dui_pct']}% ({_fmt(d['dui'])} incidents), "
            f"compared to the statewide {d['st_dui_pct']}%."
        )
    elif d["dui_pct"] < 5 and d["tc"] > 500:
        parts.append(
            f"DUI involvement is relatively low at {d['dui_pct']}%, well below the "
            f"state average of {d['st_dui_pct']}%."
        )

    # Top 3 summary if we haven't said enough
    if len(parts) < 2 and len(top3) >= 3:
        parts.append(
            f'The top three causes — {", ".join(c[0].replace("_"," ") for c in top3)} — '
            f"account for {sum(c[2] for c in top3):.0f}% of all crashes."
        )

    return " ".join(parts[:2])


def compose_dui(name: str, d: dict) -> str:
    """Alcohol involvement analysis."""
    parts = []

    diff = d["dui_pct"] - d["st_dui_pct"]
    if abs(diff) > 2:
        direction = "above" if diff > 0 else "below"
        parts.append(
            f"Alcohol-involved crashes make up {d['dui_pct']}% of all collisions in "
            f"{name} County — {abs(diff):.1f} percentage points {direction} the statewide "
            f"average of {d['st_dui_pct']}%. That translates to {_fmt(d['dui'])} "
            f"DUI-related crashes in {d['year']}."
        )
    else:
        parts.append(
            f"{name} County's DUI rate of {d['dui_pct']}% ({_fmt(d['dui'])} crashes) "
            f"tracks close to the state average of {d['st_dui_pct']}%."
        )

    # DUI fatality disproportionality
    if d["dui"] > 10 and d["tk"] > 0:
        # Check if DUI crashes are disproportionately fatal
        dui_fatal_text = (
            "While DUI crashes represent a fraction of total volume, they "
            "consistently account for a disproportionate share of fatalities "
            "— impaired drivers are far more likely to be in high-speed, "
            "single-vehicle collisions."
        )
        if d["dui_pct"] < 15 and d["fat_rate"] > 1:
            parts.append(dui_fatal_text)

    # Historical DUI trend
    dui_years = [(y, k) for y, cnt, k in d["hist"] if y >= 2016]
    if len(dui_years) >= 3:
        early_k = sum(k for _, k in dui_years[:2])
        late_k = sum(k for _, k in dui_years[-2:])
        if early_k > 0:
            k_change = round((late_k - early_k) / early_k * 100)
            if abs(k_change) > 20:
                direction = "risen" if k_change > 0 else "fallen"
                parts.append(
                    f"Fatalities have {direction} {abs(k_change)}% comparing "
                    f"recent years to the start of the tracking period."
                )

    return " ".join(parts[:2])


def compose_safety_ranking(name: str, d: dict) -> str:
    """Where this county ranks and why."""
    parts = []

    if d["rank"]:
        parts.append(
            f"{name} County ranks {_ordinal(d['rank'])} out of 58 California counties "
            f"by crash volume with {_fmt(d['tc'])} collisions in {d['year']}."
        )

    if d["fat_rank"] and d["tc"] >= 100:
        if d["fat_rank"] <= 10:
            parts.append(
                f"More critically, it ranks {_ordinal(d['fat_rank'])} in fatality rate "
                f"at {d['fat_rate']}% — meaning a higher proportion of crashes here are "
                f"deadly compared to most of the state."
            )
        elif d["fat_rank"] >= 40:
            parts.append(
                f"On the positive side, its fatality rate of {d['fat_rate']}% places it "
                f"{_ordinal(d['fat_rank'])} — crashes here are less likely to be fatal "
                f"than in most California counties."
            )

    if d["per_cap"] and d["pop"]:
        if d["per_cap"] > 3000:
            parts.append(
                f"Per capita, the county sees {_fmt(d['per_cap'])} crashes per 100,000 "
                f"residents — elevated partly because through-traffic inflates crash "
                f"counts beyond what the local population would suggest."
            )
        elif d["per_cap"] < 1000 and d["pop"] > 100000:
            parts.append(
                f"The per-capita rate of {_fmt(d['per_cap'])} crashes per 100,000 "
                f"residents is notably low for a county of {_fmt(d['pop'])} people."
            )

    return " ".join(parts[:2]) if parts else (
        f"{name} County recorded {_fmt(d['tc'])} crashes and {_fmt(d['tk'])} "
        f"fatalities in {d['year']}."
    )


def compose_geography(name: str, d: dict) -> str:
    """How geography shapes crash patterns."""
    parts = []

    if d["hw_pct"] > 30:
        parts.append(
            f"Highway and freeway crashes account for {d['hw_pct']}% of all collisions "
            f"in {name} County ({_fmt(d['hw_count'])} incidents), reflecting the "
            f"county's dependence on major corridors for both local commutes and "
            f"through-traffic."
        )
    elif d["hw_pct"] < 10 and d["tc"] > 500:
        parts.append(
            f"Only {d['hw_pct']}% of crashes occur on highways — the vast majority "
            f"happen on local streets and intersections, consistent with {name} County's "
            f"dense urban grid."
        )

    if d["density"] and d["density"] > 1000:
        parts.append(
            f"With {round(d['density']):,} people per square mile, tight urban streets "
            f"create constant conflict points between cars, pedestrians, and cyclists."
        )
    elif d["density"] and d["density"] < 50:
        parts.append(
            f"At just {round(d['density'])} people per square mile, long stretches of "
            f"rural highway with higher speeds and limited lighting contribute to the "
            f"county's elevated fatality rate."
        )

    if d["ped_pct"] > 5 and d["ped"] > 30:
        parts.append(
            f"Pedestrian crashes are prominent at {d['ped_pct']}% — {_fmt(d['ped'])} "
            f"people struck while walking."
        )

    return " ".join(parts[:2]) if parts else (
        f"{name} County's {_fmt(d['tc'])} crashes span highways, local roads, "
        f"and intersections across its varied terrain."
    )


def compose_seasonal(name: str, d: dict) -> str:
    """Seasonal crash patterns."""
    if not d["months"]:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."

    by_month = {m: c for m, c in d["months"]}
    busiest_m = d["months"][0]
    quietest_m = d["months"][-1]
    spread = round((busiest_m[1] - quietest_m[1]) / quietest_m[1] * 100) if quietest_m[1] > 0 else 0

    parts = []

    # Summer vs winter
    summer = sum(by_month.get(m, 0) for m in [6, 7, 8])
    winter = sum(by_month.get(m, 0) for m in [12, 1, 2])
    if summer > winter * 1.2:
        pct_more = round((summer - winter) / winter * 100)
        parts.append(
            f"Summer months (June-August) see {pct_more}% more crashes than winter "
            f"(December-February) in {name} County — more people on the road means "
            f"more collisions, even with better weather."
        )
    elif winter > summer * 1.1:
        pct_more = round((winter - summer) / summer * 100)
        parts.append(
            f"Winter crashes outpace summer by {pct_more}% in {name} County, likely "
            f"driven by rain, fog, shorter daylight hours, and holiday travel."
        )

    parts.append(
        f"{MONTH_NAMES[busiest_m[0]]} is the peak month at {_fmt(busiest_m[1])} crashes "
        f"({spread}% more than {MONTH_NAMES[quietest_m[0]]}, the quietest at "
        f"{_fmt(quietest_m[1])})."
    )

    return " ".join(parts[:2])


def compose_pedestrian(name: str, d: dict) -> str:
    """Pedestrian and cyclist safety."""
    parts = []

    if d["ped"] > 0:
        diff = d["ped_pct"] - d["st_ped_pct"]
        if diff > 1.5:
            parts.append(
                f"Pedestrian safety is a serious concern in {name} County: {_fmt(d['ped'])} "
                f"pedestrians were struck in {d['year']}, making up {d['ped_pct']}% of all "
                f"crashes — well above the statewide {d['st_ped_pct']}%."
            )
        elif d["ped"] > 10:
            parts.append(
                f"{_fmt(d['ped'])} pedestrians were involved in crashes in {name} County "
                f"in {d['year']} ({d['ped_pct']}% of all collisions, vs {d['st_ped_pct']}% "
                f"statewide)."
            )

    if d["cyc"] > 5:
        parts.append(
            f"Cyclist-involved crashes totaled {_fmt(d['cyc'])} ({d['cyc_pct']}% of "
            f"collisions, compared to {d['st_cyc_pct']}% statewide)."
        )

    if not parts:
        return (
            f"{name} County recorded {_fmt(d['ped'])} pedestrian and {_fmt(d['cyc'])} "
            f"cyclist crashes in {d['year']}."
        )

    return " ".join(parts[:2])


def compose_hit_and_run(name: str, d: dict) -> str:
    """Hit-and-run analysis compared to state rate."""
    if d["hr"] == 0:
        return (
            f"{name} County reported no hit-and-run crashes in {d['year']}, "
            f"a rarity across California where the statewide rate is {d['st_hr_pct']}%."
        )
    diff = d["hr_pct"] - d["st_hr_pct"]
    parts = []
    if diff > 2:
        parts.append(
            f"Hit-and-run crashes are a serious problem in {name} County: {_fmt(d['hr'])} "
            f"drivers fled the scene in {d['year']}, representing {d['hr_pct']}% of all "
            f"crashes — {abs(diff):.1f} points above the statewide rate of {d['st_hr_pct']}%."
        )
    elif diff < -2:
        parts.append(
            f"Drivers in {name} County are more likely to stay at the scene: only "
            f"{d['hr_pct']}% of crashes involved a fleeing driver, compared to "
            f"{d['st_hr_pct']}% statewide ({_fmt(d['hr'])} incidents total)."
        )
    else:
        parts.append(
            f"{name} County's hit-and-run rate of {d['hr_pct']}% ({_fmt(d['hr'])} incidents) "
            f"tracks near the statewide average of {d['st_hr_pct']}%."
        )
    if d["hr"] > 100:
        per_day = round(d["hr"] / 365, 1)
        parts.append(
            f"That works out to roughly {per_day} hit-and-run incidents every day — "
            f"nearly one every {round(24 / per_day)} hours."
        )
    return " ".join(parts[:2])


def compose_cyclist(name: str, d: dict) -> str:
    """Cyclist-specific crash analysis."""
    if d["cyc"] == 0:
        return (
            f"{name} County recorded zero cyclist-involved crashes in {d['year']}, "
            f"likely reflecting low cycling activity rather than perfect safety."
        )
    diff = d["cyc_pct"] - d["st_cyc_pct"]
    parts = []
    if diff > 1:
        parts.append(
            f"Cyclists face elevated risk in {name} County: {_fmt(d['cyc'])} cyclist-involved "
            f"crashes occurred in {d['year']} ({d['cyc_pct']}% of all collisions), well above "
            f"the statewide {d['st_cyc_pct']}%."
        )
    elif diff < -1 and d["cyc"] > 5:
        parts.append(
            f"Cyclist crashes are relatively uncommon in {name} County at {d['cyc_pct']}% "
            f"of all collisions ({_fmt(d['cyc'])} incidents), below the state average of "
            f"{d['st_cyc_pct']}%."
        )
    else:
        parts.append(
            f"{name} County saw {_fmt(d['cyc'])} cyclist-involved crashes in {d['year']} "
            f"({d['cyc_pct']}% of collisions, vs {d['st_cyc_pct']}% statewide)."
        )
    if d["density"] and d["density"] > 500 and d["cyc_pct"] > 3:
        parts.append(
            f"Higher population density ({_fmt(round(d['density']))} per sq mi) means more "
            f"cyclists sharing the road — and more potential conflict points at intersections."
        )
    elif d["cyc"] > 0 and d["tc"] > 0:
        ratio = round(d["tc"] / d["cyc"])
        parts.append(
            f"Roughly 1 in every {ratio} crashes involves a cyclist — "
            f"a vulnerable road user with no metal shell for protection."
        )
    return " ".join(parts[:2])


def compose_time_of_day(name: str, d: dict) -> str:
    """Peak hour and night-vs-day analysis."""
    if not d["peak_hour"]:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."
    peak_h, peak_cnt = d["peak_hour"]
    peak_pct = round(peak_cnt / d["tc"] * 100, 1)
    parts = [
        f"The most dangerous hour on {name} County roads is {_hour_label(peak_h)} "
        f"to {_hour_label((peak_h + 1) % 24)}, which alone accounts for {_fmt(peak_cnt)} "
        f"crashes ({peak_pct}% of the total)."
    ]
    if 15 <= peak_h <= 18:
        parts.append(
            "This aligns with the evening commute rush — fatigue, congestion, and the "
            "setting sun create a perfect storm for collisions."
        )
    elif 7 <= peak_h <= 9:
        parts.append(
            "Morning commute hours are when alertness lags and school traffic "
            "mixes with work-bound drivers, elevating risk."
        )
    elif peak_h >= 22 or peak_h <= 5:
        parts.append(
            "A late-night peak is often linked to impaired driving, reduced visibility, "
            "and lower traffic volumes that encourage speeding."
        )
    else:
        parts.append(
            "Midday peaks often reflect high commercial and errand-running traffic "
            "rather than traditional rush-hour patterns."
        )
    return " ".join(parts[:2])


def compose_weekend_weekday(name: str, d: dict) -> str:
    """Weekend vs weekday crash patterns."""
    if not d["dow"]:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."
    by_dow = {dw: c for dw, c in d["dow"]}
    weekend = sum(by_dow.get(dw, 0) for dw in [0, 6])  # Sun=0, Sat=6
    weekday = sum(by_dow.get(dw, 0) for dw in [1, 2, 3, 4, 5])
    if weekday == 0:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."
    avg_weekend = weekend / 2
    avg_weekday = weekday / 5
    busiest_dow = d["dow"][0]
    busiest_name = DOW_NAMES.get(busiest_dow[0], "Unknown")
    parts = []
    if avg_weekend > avg_weekday * 1.15:
        pct_more = round((avg_weekend - avg_weekday) / avg_weekday * 100)
        parts.append(
            f"Weekends are notably more dangerous in {name} County: the average Saturday "
            f"or Sunday sees {pct_more}% more crashes than a typical weekday."
        )
    elif avg_weekday > avg_weekend * 1.15:
        pct_more = round((avg_weekday - avg_weekend) / avg_weekend * 100)
        parts.append(
            f"Weekdays drive the crash count in {name} County, averaging {pct_more}% more "
            f"collisions per day than weekends — commuter traffic is the dominant factor."
        )
    else:
        parts.append(
            f"Crashes in {name} County are spread fairly evenly across the week, with no "
            f"dramatic weekend spike — suggesting consistent daily traffic patterns."
        )
    parts.append(
        f"{busiest_name} is the single busiest day with {_fmt(busiest_dow[1])} crashes, "
        f"accounting for {round(busiest_dow[1] / d['tc'] * 100, 1)}% of the weekly total."
    )
    return " ".join(parts[:2])


def compose_highway(name: str, d: dict) -> str:
    """Highway vs local road analysis."""
    local = d["tc"] - d["hw_count"]
    local_pct = round(local / d["tc"] * 100, 1) if d["tc"] > 0 else 0
    parts = []
    if d["hw_pct"] > 30:
        parts.append(
            f"Highways carry an outsized share of danger in {name} County: "
            f"{_fmt(d['hw_count'])} crashes ({d['hw_pct']}%) occurred on highways and "
            f"freeways, where higher speeds turn minor mistakes into serious collisions."
        )
    elif d["hw_pct"] < 10 and d["tc"] > 200:
        parts.append(
            f"Local streets — not highways — are where crashes concentrate in {name} County. "
            f"Just {d['hw_pct']}% of crashes happen on highways, while {local_pct}% occur "
            f"on surface streets and intersections."
        )
    else:
        parts.append(
            f"In {name} County, {d['hw_pct']}% of crashes occur on highways "
            f"({_fmt(d['hw_count'])} incidents) while the remaining {local_pct}% happen "
            f"on local roads."
        )
    if d["fw_count"] > 0 and d["hw_count"] > 0:
        fw_share = round(d["fw_count"] / d["hw_count"] * 100, 1)
        parts.append(
            f"Of the highway crashes, {fw_share}% involve freeways specifically — "
            f"high-speed, limited-access roads where rear-end collisions dominate."
        )
    return " ".join(parts[:2])


def compose_fatality_paradox(name: str, d: dict) -> str:
    """Counties with high volume but low fatality rate, or vice versa."""
    parts = []
    if d["tc"] >= 500 and d["fat_rate"] < d["st_fat_rate"] * 0.6:
        parts.append(
            f"Despite ranking as a high-crash county with {_fmt(d['tc'])} collisions, "
            f"{name} County has a fatality rate of just {d['fat_rate']}% — well below "
            f"the state average of {d['st_fat_rate']}%."
        )
        parts.append(
            "Lower speeds in dense urban environments mean crashes are more frequent "
            "but less deadly — fender-benders replace fatal head-on collisions."
        )
    elif d["tc"] < 500 and d["fat_rate"] > d["st_fat_rate"] * 1.5 and d["tc"] >= 50:
        parts.append(
            f"{name} County sees relatively few crashes ({_fmt(d['tc'])}), but those that "
            f"happen are disproportionately deadly: a {d['fat_rate']}% fatality rate versus "
            f"the state's {d['st_fat_rate']}%."
        )
        parts.append(
            "Rural roads with higher speed limits, longer emergency response times, and "
            "limited lighting are the usual culprits behind this paradox."
        )
    else:
        volume_label = "high" if d["tc"] > 2000 else "moderate" if d["tc"] > 500 else "low"
        parts.append(
            f"{name} County has {volume_label} crash volume ({_fmt(d['tc'])}) and a "
            f"fatality rate of {d['fat_rate']}% (state: {d['st_fat_rate']}%)."
        )
        if d["tk"] > 0:
            parts.append(
                f"Each of the {_fmt(d['tk'])} lives lost represents a preventable tragedy "
                f"— the gap between crash volume and fatal outcomes reveals where "
                f"intervention can save the most lives."
            )
    return " ".join(parts[:2])


def compose_trend(name: str, d: dict) -> str:
    """Multi-year trend from historical data."""
    hist = d["hist"]
    if len(hist) < 3:
        return (
            f"Insufficient historical data to identify a trend for {name} County. "
            f"In {d['year']}, the county recorded {_fmt(d['tc'])} crashes."
        )
    first_year, first_cnt, first_k = hist[0]
    last_year, last_cnt, last_k = hist[-1]
    pct_change = round((last_cnt - first_cnt) / first_cnt * 100) if first_cnt > 0 else 0
    span = last_year - first_year
    parts = []
    if pct_change > 15:
        parts.append(
            f"Crash numbers in {name} County have risen {abs(pct_change)}% over {span} years, "
            f"from {_fmt(first_cnt)} in {first_year} to {_fmt(last_cnt)} in {last_year}."
        )
    elif pct_change < -15:
        parts.append(
            f"Good news: crashes in {name} County have dropped {abs(pct_change)}% over "
            f"{span} years, from {_fmt(first_cnt)} in {first_year} to {_fmt(last_cnt)} "
            f"in {last_year}."
        )
    else:
        parts.append(
            f"Crash volume in {name} County has remained relatively stable over {span} years, "
            f"hovering between {_fmt(min(c for _, c, _ in hist))} and "
            f"{_fmt(max(c for _, c, _ in hist))} per year."
        )
    if first_k and first_k > 0 and last_k is not None:
        k_change = round((last_k - first_k) / first_k * 100)
        if abs(k_change) > 20:
            direction = "increased" if k_change > 0 else "decreased"
            parts.append(
                f"Fatalities have {direction} {abs(k_change)}% over the same period — "
                f"from {_fmt(first_k)} deaths in {first_year} to {_fmt(last_k)} in {last_year}."
            )
    return " ".join(parts[:2])


def compose_income_inequality(name: str, d: dict) -> str:
    """Crash rate vs income and poverty correlation."""
    if not d["income"] or not d["poverty"]:
        return (
            f"Demographic data is unavailable for {name} County in {d['year']}. "
            f"The county recorded {_fmt(d['tc'])} crashes."
        )
    parts = []
    if d["poverty"] and d["poverty"] > 15 and d["per_cap"] and d["per_cap"] > 2000:
        parts.append(
            f"{name} County's poverty rate of {d['poverty']}% coincides with an elevated "
            f"crash rate of {_fmt(d['per_cap'])} per 100,000 residents. Research consistently "
            f"links economic disadvantage to higher crash exposure through older vehicles, "
            f"longer commutes, and less-maintained roads."
        )
    elif d["income"] and d["income"] > 80000 and d["per_cap"] and d["per_cap"] < 1500:
        parts.append(
            f"With a median income of ${_fmt(d['income'])} and a crash rate of "
            f"{_fmt(d['per_cap'])} per 100,000, {name} County fits a common pattern: "
            f"wealthier areas tend to have newer vehicles, better infrastructure, and "
            f"lower crash rates."
        )
    else:
        income_str = f"${_fmt(d['income'])}" if d["income"] else "unknown"
        parts.append(
            f"{name} County has a median income of {income_str} and a poverty rate of "
            f"{d['poverty']}%."
        )
        if d["per_cap"]:
            parts.append(
                f"Its crash rate of {_fmt(d['per_cap'])} per 100,000 residents reflects "
                f"the intersection of economic conditions, road design, and driving patterns."
            )
    return " ".join(parts[:2])


def compose_commuter(name: str, d: dict) -> str:
    """Commute patterns and crash relationship."""
    if not d["commute_drive"]:
        return (
            f"Commuter data is unavailable for {name} County. "
            f"The county recorded {_fmt(d['tc'])} crashes in {d['year']}."
        )
    parts = []
    if d["commute_drive"] > 80:
        parts.append(
            f"A striking {d['commute_drive']}% of {name} County residents drive alone to "
            f"work — heavy car dependence means more vehicles on the road and more "
            f"opportunity for collisions ({_fmt(d['tc'])} total in {d['year']})."
        )
    elif d["commute_drive"] < 65:
        parts.append(
            f"Only {d['commute_drive']}% of {name} County residents drive alone to work, "
            f"suggesting robust transit, carpooling, or remote work options that help "
            f"reduce vehicle exposure."
        )
    else:
        parts.append(
            f"{d['commute_drive']}% of {name} County commuters drive alone — "
            f"close to the statewide norm — contributing to {_fmt(d['tc'])} total crashes "
            f"in {d['year']}."
        )
    if d["peak_hour"] and 7 <= d["peak_hour"][0] <= 9:
        parts.append(
            "The morning commute window is the most dangerous hour, aligning with the "
            "high solo-driving rate."
        )
    elif d["peak_hour"] and 15 <= d["peak_hour"][0] <= 18:
        parts.append(
            "The evening rush dominates crash timing — when commuters mix with "
            "school pickups and errand traffic."
        )
    return " ".join(parts[:2])


def compose_fun_fact_timing(name: str, d: dict) -> str:
    """Interesting time-based facts about crash frequency."""
    parts = []
    minutes_per_crash = round(365.25 * 24 * 60 / d["tc"]) if d["tc"] > 0 else 0
    if minutes_per_crash > 0:
        if minutes_per_crash < 60:
            parts.append(
                f"On average, a crash occurs somewhere in {name} County every "
                f"{minutes_per_crash} minutes — that's {_fmt(d['tc'])} collisions "
                f"across {d['year']}."
            )
        elif minutes_per_crash < 1440:
            hours = round(minutes_per_crash / 60, 1)
            parts.append(
                f"A crash happens roughly every {hours} hours in {name} County — "
                f"totaling {_fmt(d['tc'])} for {d['year']}."
            )
        else:
            days = round(minutes_per_crash / 1440, 1)
            parts.append(
                f"With {_fmt(d['tc'])} crashes in {d['year']}, {name} County averages "
                f"one collision every {days} days."
            )
    if d["tk"] > 0:
        days_per_death = round(365 / d["tk"], 1)
        if days_per_death < 7:
            parts.append(
                f"Tragically, someone dies on {name} County roads roughly every "
                f"{days_per_death} days — {_fmt(d['tk'])} lives lost in a single year."
            )
        else:
            parts.append(
                f"On average, a traffic fatality occurs every {days_per_death} days — "
                f"{_fmt(d['tk'])} deaths total in {d['year']}."
            )
    else:
        parts.append(
            f"Remarkably, {name} County recorded zero traffic fatalities in {d['year']}."
        )
    return " ".join(parts[:2])


def compose_fun_fact_comparison(name: str, d: dict) -> str:
    """Compare county crash numbers to relatable benchmarks."""
    parts = []
    # Compare crash count to population of small cities
    if d["tc"] > 50000:
        parts.append(
            f"{name} County's {_fmt(d['tc'])} crashes in {d['year']} exceed the entire "
            f"population of cities like Calistoga or Colma — imagine every resident "
            f"of a small town involved in a separate collision."
        )
    elif d["tc"] > 10000:
        per_day = round(d["tc"] / 365)
        parts.append(
            f"With {_fmt(d['tc'])} crashes in {d['year']}, {name} County averaged "
            f"{_fmt(per_day)} collisions per day — enough to fill a mid-size parking "
            f"lot with damaged vehicles every single day."
        )
    elif d["tc"] > 1000:
        per_week = round(d["tc"] / 52)
        parts.append(
            f"{name} County averaged {_fmt(per_week)} crashes per week in {d['year']} — "
            f"roughly {round(per_week / 7)} every single day, weekends included."
        )
    else:
        per_month = round(d["tc"] / 12)
        parts.append(
            f"{name} County sees about {_fmt(per_month)} crashes per month — "
            f"{_fmt(d['tc'])} total in {d['year']}."
        )
    if d["county_share"] > 5:
        parts.append(
            f"This single county accounts for {d['county_share']}% of all crashes in "
            f"California — a disproportionate share of the state's traffic burden."
        )
    elif d["pop"] and d["tc"] > d["pop"] * 0.01:
        parts.append(
            f"That means roughly 1 in every {round(d['pop'] / d['tc'])} residents was "
            f"involved in a reported crash."
        )
    return " ".join(parts[:2])


def compose_fun_fact_records(name: str, d: dict) -> str:
    """Records and extremes for the county."""
    parts = []
    if d["rank"] and d["rank"] <= 3:
        parts.append(
            f"{name} County holds the {_ordinal(d['rank'])} highest crash count in all "
            f"of California with {_fmt(d['tc'])} collisions in {d['year']} — a dubious "
            f"distinction driven by population and traffic volume."
        )
    elif d["rank"] and d["rank"] >= 56:
        parts.append(
            f"With just {_fmt(d['tc'])} crashes, {name} County ranks {_ordinal(d['rank'])} "
            f"out of 58 — one of the quietest counties in California for traffic incidents."
        )
    elif d["fat_rank"] and d["fat_rank"] <= 3 and d["tc"] >= 100:
        parts.append(
            f"{name} County has the {_ordinal(d['fat_rank'])} highest fatality rate among "
            f"California counties with 100+ crashes: {d['fat_rate']}% of collisions are "
            f"fatal, compared to {d['st_fat_rate']}% statewide."
        )
    else:
        parts.append(
            f"{name} County recorded {_fmt(d['tc'])} crashes and {_fmt(d['tk'])} fatalities "
            f"in {d['year']}, ranking {_ordinal(d['rank'])} in volume statewide."
            if d["rank"]
            else f"{name} County recorded {_fmt(d['tc'])} crashes and {_fmt(d['tk'])} "
            f"fatalities in {d['year']}."
        )
    # Peak month extreme
    if d["months"]:
        peak_m, peak_cnt = d["months"][0]
        parts.append(
            f"The single worst month was {MONTH_NAMES[peak_m]} with {_fmt(peak_cnt)} "
            f"crashes — {round(peak_cnt / d['tc'] * 100, 1)}% of the year's total "
            f"packed into 30 days."
        )
    return " ".join(parts[:2])


def compose_decade_comparison(name: str, d: dict) -> str:
    """Compare recent years to 10 years ago from hist data."""
    hist = d["hist"]
    if len(hist) < 5:
        return (
            f"Not enough historical data to compare decades for {name} County. "
            f"In {d['year']}, it recorded {_fmt(d['tc'])} crashes."
        )
    recent = hist[-2:]
    recent_avg = round(sum(c for _, c, _ in recent) / len(recent))
    recent_k_avg = round(sum(k for _, _, k in recent) / len(recent))
    # Find entries roughly 10 years before the most recent
    target_year = recent[-1][0] - 10
    old = [h for h in hist if abs(h[0] - target_year) <= 2]
    if not old:
        old = hist[:2]
    old_avg = round(sum(c for _, c, _ in old) / len(old))
    old_k_avg = round(sum(k for _, _, k in old) / len(old))
    pct_change = round((recent_avg - old_avg) / old_avg * 100) if old_avg > 0 else 0
    parts = []
    old_label = f"{old[0][0]}-{old[-1][0]}" if len(old) > 1 else str(old[0][0])
    recent_label = f"{recent[0][0]}-{recent[-1][0]}" if len(recent) > 1 else str(recent[0][0])
    if abs(pct_change) > 10:
        direction = "increased" if pct_change > 0 else "decreased"
        parts.append(
            f"Comparing {old_label} to {recent_label}, crashes in {name} County have "
            f"{direction} {abs(pct_change)}% — from an average of {_fmt(old_avg)} to "
            f"{_fmt(recent_avg)} per year."
        )
    else:
        parts.append(
            f"Crash volume in {name} County has stayed remarkably flat over the past "
            f"decade: ~{_fmt(old_avg)} per year around {old_label} vs ~{_fmt(recent_avg)} "
            f"recently."
        )
    if old_k_avg > 0:
        k_change = round((recent_k_avg - old_k_avg) / old_k_avg * 100)
        if abs(k_change) > 15:
            k_dir = "risen" if k_change > 0 else "fallen"
            parts.append(
                f"Fatalities have {k_dir} {abs(k_change)}% over the same span — "
                f"from ~{_fmt(old_k_avg)} deaths per year to ~{_fmt(recent_k_avg)}."
            )
    return " ".join(parts[:2])


def compose_severity_breakdown(name: str, d: dict) -> str:
    """Deep dive into fatal vs injury vs PDO proportions."""
    parts = []
    fatal = d["fatal_count"]
    pdo = d["pdo_count"]
    injury = d["ti"]
    fatal_pct = round(fatal / d["tc"] * 100, 1) if d["tc"] > 0 else 0
    pdo_pct = round(pdo / d["tc"] * 100, 1) if d["tc"] > 0 else 0
    if pdo_pct > 50:
        parts.append(
            f"The majority of crashes in {name} County are property-damage-only: "
            f"{_fmt(pdo)} incidents ({pdo_pct}%) resulted in bent metal but no injuries."
        )
    elif fatal_pct > 2:
        parts.append(
            f"A troubling {fatal_pct}% of crashes in {name} County were fatal — "
            f"{_fmt(fatal)} collisions that claimed lives, far exceeding the state "
            f"average of {d['st_fat_rate']}%."
        )
    else:
        parts.append(
            f"Of {name} County's {_fmt(d['tc'])} crashes, {_fmt(fatal)} were fatal "
            f"({fatal_pct}%) and {_fmt(pdo)} were property-damage-only ({pdo_pct}%)."
        )
    if injury > 0 and d["tc"] > 0:
        inj_per_crash = round(injury / d["tc"], 2)
        parts.append(
            f"Across all crashes, {_fmt(injury)} people were injured — an average of "
            f"{inj_per_crash} injuries per collision."
        )
    return " ".join(parts[:2])


def compose_nighttime(name: str, d: dict) -> str:
    """Analyze crashes during dark hours (10pm-6am) using peak_hour proxy."""
    if not d["peak_hour"]:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."
    peak_h, _ = d["peak_hour"]
    parts = []
    if peak_h >= 22 or peak_h <= 5:
        parts.append(
            f"Nighttime hours are unusually dangerous in {name} County — crash activity "
            f"peaks between {_hour_label(peak_h)} and {_hour_label((peak_h + 1) % 24)}, "
            f"when darkness, fatigue, and impaired driving converge."
        )
    else:
        parts.append(
            f"Crashes in {name} County peak during daylight hours "
            f"({_hour_label(peak_h)}), but nighttime collisions between 10 PM and 6 AM "
            f"tend to be more severe due to reduced visibility and higher speeds."
        )
    if d["dui_pct"] > 8:
        parts.append(
            f"The county's {d['dui_pct']}% DUI rate suggests alcohol plays a significant "
            f"role in after-dark incidents — impaired drivers are overrepresented in "
            f"nighttime fatalities."
        )
    elif d["fat_rate"] > d["st_fat_rate"]:
        parts.append(
            f"With a fatality rate of {d['fat_rate']}% (above the state's "
            f"{d['st_fat_rate']}%), the county's nighttime crashes are especially lethal."
        )
    return " ".join(parts[:2])


def compose_population_density(name: str, d: dict) -> str:
    """How population density affects crash patterns."""
    if not d["density"]:
        return (
            f"Population density data is unavailable for {name} County. "
            f"It recorded {_fmt(d['tc'])} crashes in {d['year']}."
        )
    parts = []
    if d["density"] > 2000:
        parts.append(
            f"At {_fmt(round(d['density']))} people per square mile, {name} County is one "
            f"of California's most densely packed areas — and dense streets mean constant "
            f"conflict between cars, bikes, and pedestrians ({_fmt(d['tc'])} crashes total)."
        )
    elif d["density"] > 500:
        parts.append(
            f"{name} County's suburban density of {_fmt(round(d['density']))} people per "
            f"square mile creates a mix of arterial roads and neighborhood streets that "
            f"generated {_fmt(d['tc'])} crashes in {d['year']}."
        )
    elif d["density"] > 50:
        parts.append(
            f"With {_fmt(round(d['density']))} people per square mile, {name} County's "
            f"semi-rural landscape means longer drives, higher speeds, and "
            f"{_fmt(d['tc'])} crashes in {d['year']}."
        )
    else:
        parts.append(
            f"At just {_fmt(round(d['density']))} people per square mile, {name} County "
            f"is deeply rural — fewer crashes ({_fmt(d['tc'])}) but each one is more "
            f"likely to be severe."
        )
    if d["per_cap"]:
        parts.append(
            f"The per-capita crash rate is {_fmt(d['per_cap'])} per 100,000 residents, "
            f"{'elevated by through-traffic that inflates crash counts beyond what residents alone would cause.'if d['per_cap'] > 3000 else 'reflecting the balance between road design and driving volume.'}"
        )
    return " ".join(parts[:2])


def compose_what_if(name: str, d: dict) -> str:
    """'If every county had this rate, California would see X fewer deaths.'"""
    if not d["per_cap"] or not d["pop"] or d["pop"] == 0:
        return (
            f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}. "
            f"Per-capita data is unavailable for projection."
        )
    parts = []
    ca_pop = 39_000_000  # approximate California population
    projected_crashes = round(d["per_cap"] / 100_000 * ca_pop)
    actual_state = d["st_tc"]
    diff = actual_state - projected_crashes
    if diff > 1000:
        parts.append(
            f"If every California county matched {name} County's crash rate of "
            f"{_fmt(d['per_cap'])} per 100,000 residents, the state would see roughly "
            f"{_fmt(projected_crashes)} crashes — {_fmt(abs(diff))} fewer than the "
            f"actual {_fmt(actual_state)}."
        )
    elif diff < -1000:
        parts.append(
            f"If all of California crashed at {name} County's rate of "
            f"{_fmt(d['per_cap'])} per 100,000, the state total would jump to "
            f"~{_fmt(projected_crashes)} — {_fmt(abs(diff))} more than today's "
            f"{_fmt(actual_state)}."
        )
    else:
        parts.append(
            f"{name} County's crash rate of {_fmt(d['per_cap'])} per 100,000 is close "
            f"to the statewide average — scaling it up would produce roughly the same "
            f"{_fmt(actual_state)} total crashes."
        )
    if d["fat_rate"] > 0 and d["st_fat_rate"] > 0:
        projected_deaths = round(projected_crashes * d["fat_rate"] / 100)
        actual_deaths = d["st_tk"]
        death_diff = actual_deaths - projected_deaths
        if abs(death_diff) > 50:
            more_fewer = "fewer" if death_diff > 0 else "more"
            parts.append(
                f"Applied to fatalities, that would mean ~{_fmt(projected_deaths)} deaths "
                f"statewide — {_fmt(abs(death_diff))} {more_fewer} than the actual "
                f"{_fmt(actual_deaths)}."
            )
    return " ".join(parts[:2])


def compose_speeding(name: str, d: dict) -> str:
    """Speeding-specific analysis from causes data."""
    speed_causes = [
        (cause, cnt, pct)
        for cause, cnt, pct in d["causes"]
        if "speed" in cause.lower() or "unsafe_speed" in cause.lower()
    ]
    if not speed_causes:
        return (
            f"Speeding does not appear as a separately tracked cause in {name} County's "
            f"{d['year']} data, though it may be embedded within other categories like "
            f"unsafe driving."
        )
    total_speed = sum(cnt for _, cnt, _ in speed_causes)
    total_pct = round(total_speed / d["tc"] * 100, 1) if d["tc"] > 0 else 0
    parts = []
    parts.append(
        f"Speed-related crashes account for {total_pct}% of collisions in {name} County "
        f"— {_fmt(total_speed)} incidents in {d['year']} where excessive or unsafe speed "
        f"was a contributing factor."
    )
    if d["fat_rate"] > d["st_fat_rate"] and total_pct > 10:
        parts.append(
            f"Combined with a fatality rate of {d['fat_rate']}% (above the state's "
            f"{d['st_fat_rate']}%), speed in {name} County doesn't just cause crashes "
            f"— it makes them deadly."
        )
    elif d["hw_pct"] > 25 and total_pct > 5:
        parts.append(
            f"With {d['hw_pct']}% of crashes on highways, higher travel speeds on "
            f"these corridors amplify both the likelihood and severity of speed-related "
            f"collisions."
        )
    return " ".join(parts[:2])


def compose_holiday(name: str, d: dict) -> str:
    """October-December holiday season patterns."""
    if not d["months"]:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."
    by_month = {m: c for m, c in d["months"]}
    holiday_months = [10, 11, 12]
    holiday_total = sum(by_month.get(m, 0) for m in holiday_months)
    non_holiday_total = sum(by_month.get(m, 0) for m in range(1, 10))
    if non_holiday_total == 0:
        return f"{name} County recorded {_fmt(d['tc'])} crashes in {d['year']}."
    holiday_avg = holiday_total / 3
    non_holiday_avg = non_holiday_total / 9
    parts = []
    if holiday_avg > non_holiday_avg * 1.1:
        pct_more = round((holiday_avg - non_holiday_avg) / non_holiday_avg * 100)
        parts.append(
            f"The October-December holiday season brings a {pct_more}% spike in monthly "
            f"crash rates for {name} County: {_fmt(holiday_total)} crashes across three "
            f"months, versus a {_fmt(round(non_holiday_avg))}/month average the rest of "
            f"the year."
        )
    elif holiday_avg < non_holiday_avg * 0.9:
        pct_less = round((non_holiday_avg - holiday_avg) / non_holiday_avg * 100)
        parts.append(
            f"Counter to the national trend, {name} County actually sees {pct_less}% "
            f"fewer crashes per month during the October-December holiday season than "
            f"during the rest of the year."
        )
    else:
        parts.append(
            f"Holiday season (October-December) crash rates in {name} County are roughly "
            f"in line with the rest of the year: {_fmt(holiday_total)} crashes across "
            f"three months."
        )
    dec = by_month.get(12, 0)
    oct = by_month.get(10, 0)
    if dec > 0 and oct > 0:
        peak_holiday = max((10, oct), (11, by_month.get(11, 0)), (12, dec), key=lambda x: x[1])
        parts.append(
            f"{MONTH_NAMES[peak_holiday[0]]} is the worst holiday-season month with "
            f"{_fmt(peak_holiday[1])} crashes — likely influenced by "
            f"{'Halloween and early holiday travel' if peak_holiday[0] == 10 else 'Thanksgiving travel' if peak_holiday[0] == 11 else 'Christmas and New Year celebrations'}."
        )
    return " ".join(parts[:2])


def compose_recovery_pattern(name: str, d: dict) -> str:
    """Post-COVID crash trends from hist data."""
    hist = d["hist"]
    pre_covid = [h for h in hist if h[0] in (2018, 2019)]
    covid_year = [h for h in hist if h[0] == 2020]
    post_covid = [h for h in hist if h[0] in (2021, 2022, 2023)]
    if not pre_covid or not covid_year:
        if len(hist) >= 2:
            return compose_trend(name, d)
        return (
            f"Historical data is limited for {name} County. "
            f"In {d['year']}, it recorded {_fmt(d['tc'])} crashes."
        )
    pre_avg = round(sum(c for _, c, _ in pre_covid) / len(pre_covid))
    covid_cnt = covid_year[0][1]
    covid_drop = round((pre_avg - covid_cnt) / pre_avg * 100) if pre_avg > 0 else 0
    parts = []
    if covid_drop > 10:
        parts.append(
            f"COVID-19 lockdowns drove a {covid_drop}% crash reduction in {name} County: "
            f"from ~{_fmt(pre_avg)} per year pre-pandemic to {_fmt(covid_cnt)} in 2020."
        )
    elif covid_drop < -5:
        parts.append(
            f"Unusually, {name} County saw more crashes during 2020 ({_fmt(covid_cnt)}) "
            f"than pre-pandemic ({_fmt(pre_avg)}/year) — emptier roads may have "
            f"encouraged riskier driving."
        )
    else:
        parts.append(
            f"The pandemic barely dented crash numbers in {name} County: {_fmt(covid_cnt)} "
            f"in 2020 versus ~{_fmt(pre_avg)} pre-pandemic."
        )
    if post_covid:
        post_avg = round(sum(c for _, c, _ in post_covid) / len(post_covid))
        recovery_pct = round((post_avg - pre_avg) / pre_avg * 100) if pre_avg > 0 else 0
        if recovery_pct > 5:
            parts.append(
                f"Post-pandemic, crashes have surged {recovery_pct}% above pre-COVID "
                f"levels to ~{_fmt(post_avg)}/year — a nationwide pattern of riskier "
                f"driving behavior that has outlasted lockdowns."
            )
        elif recovery_pct < -5:
            parts.append(
                f"Post-pandemic volumes (~{_fmt(post_avg)}/year) remain {abs(recovery_pct)}% "
                f"below pre-COVID levels — remote work and changed commute patterns may "
                f"have permanently reduced traffic exposure."
            )
        else:
            parts.append(
                f"Crash volumes have returned to pre-COVID norms at ~{_fmt(post_avg)}/year."
            )
    return " ".join(parts[:2])


# ---------------------------------------------------------------------------
# Angle registry
# ---------------------------------------------------------------------------

ANGLES: dict[str, callable] = {
    "unique_factor": compose_unique_factor,
    "cause_focus": compose_cause_focus,
    "dui": compose_dui,
    "safety_ranking": compose_safety_ranking,
    "geography": compose_geography,
    "seasonal": compose_seasonal,
    "pedestrian": compose_pedestrian,
    "comparison": compose_safety_ranking,
    "hit_and_run": compose_hit_and_run,
    "cyclist": compose_cyclist,
    "time_of_day": compose_time_of_day,
    "weekend_weekday": compose_weekend_weekday,
    "highway": compose_highway,
    "fatality_paradox": compose_fatality_paradox,
    "trend": compose_trend,
    "income_inequality": compose_income_inequality,
    "commuter": compose_commuter,
    "fun_fact_timing": compose_fun_fact_timing,
    "fun_fact_comparison": compose_fun_fact_comparison,
    "fun_fact_records": compose_fun_fact_records,
    "decade_comparison": compose_decade_comparison,
    "severity_breakdown": compose_severity_breakdown,
    "nighttime": compose_nighttime,
    "population_density": compose_population_density,
    "what_if": compose_what_if,
    "speeding": compose_speeding,
    "holiday": compose_holiday,
    "recovery_pattern": compose_recovery_pattern,
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run() -> int:
    db = SessionLocal()
    try:
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

            data = _query_full(db, county.code, year)
            if data is None:
                continue

            for angle, composer in ANGLES.items():
                existing = (
                    db.query(CountyInsightCard)
                    .filter_by(county_code=county.code, year=year, angle=angle)
                    .first()
                )
                if existing:
                    skipped += 1
                    continue

                narrative = composer(county.name, data)
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
                logger.info("%s / %s — done", county.name, angle)

        logger.info("County cards: %d created, %d skipped (existing)", created, skipped)
        return created
    finally:
        db.close()


def run_all_years() -> int:
    """Generate cards for ALL counties × ALL years × ALL angles.

    Skips county/year/angle combos that already have a card.
    58 counties × ~20 years × 28 angles ≈ 32,000 cards.
    """
    db = SessionLocal()
    try:
        counties: list[County] = db.query(County).order_by(County.name).all()
        created = 0
        skipped = 0

        for county in counties:
            years = db.execute(text("""
                SELECT crash_year FROM crashes
                WHERE county_code = :c
                GROUP BY crash_year HAVING COUNT(*) >= 50
                ORDER BY crash_year
            """), {"c": county.code}).all()

            for (year,) in years:
                data = _query_full(db, county.code, year)
                if data is None:
                    continue

                for angle, composer in ANGLES.items():
                    existing = (
                        db.query(CountyInsightCard)
                        .filter_by(county_code=county.code, year=year, angle=angle)
                        .first()
                    )
                    if existing:
                        skipped += 1
                        continue

                    narrative = composer(county.name, data)
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
                    created += 1

                db.commit()

            logger.info("%s — all years done", county.name)

        logger.info(
            "County cards (all years): %d created, %d skipped (existing)",
            created, skipped,
        )
        return created
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
        total = run_all_years()
    else:
        total = run()
    print(f"\nDone — {total} cards generated.")
