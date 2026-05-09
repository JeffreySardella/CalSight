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

from app.database import SessionLocal
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
    if h == 0: return "midnight"
    if h == 12: return "noon"
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
    "comparison": compose_safety_ranking,  # comparison reuses ranking with context
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


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    total = run()
    print(f"\nDone — {total} cards generated.")
