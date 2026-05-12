"""Generate high-quality trend insight cards with real analysis.

Unlike the template-based fun-fact generator, this script identifies the
most interesting narrative arc in each county's crash history and composes
a unique analysis.  It looks for:

- Pandemic impact and recovery shape
- Divergence from statewide trends
- Fatality rate trends independent of crash volume
- Inflection points and regime changes
- Long-run trajectories (improving vs worsening)
- DUI trend shifts

Usage::

    cd backend
    python -m etl.generate_trend_cards
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import County, CountyInsightCard

logger = logging.getLogger(__name__)


@dataclass
class YearStats:
    year: int
    crashes: int
    killed: int
    injured: int
    dui: int

    @property
    def fatality_rate(self) -> float:
        return round(self.killed / self.crashes * 100, 2) if self.crashes > 0 else 0

    @property
    def dui_pct(self) -> float:
        return round(self.dui / self.crashes * 100, 1) if self.crashes > 0 else 0


@dataclass
class CountyTrend:
    name: str
    code: int
    population: int | None
    years: list[YearStats]
    state_years: dict[int, YearStats]


def _query_trends(db: Session) -> list[CountyTrend]:
    """Query full multi-year crash history for all counties + statewide."""
    counties: list[County] = db.query(County).order_by(County.name).all()

    # Statewide yearly totals
    state_rows = db.execute(text("""
        SELECT crash_year,
               COUNT(*) AS crashes,
               COALESCE(SUM(number_killed), 0) AS killed,
               COALESCE(SUM(number_injured), 0) AS injured,
               SUM(CASE WHEN canonical_cause = 'dui' THEN 1 ELSE 0 END) AS dui
        FROM crashes
        WHERE crash_year < EXTRACT(year FROM CURRENT_DATE)
        GROUP BY crash_year
        HAVING COUNT(*) >= 1000
        ORDER BY crash_year
    """)).all()
    state_years = {
        r.crash_year: YearStats(r.crash_year, r.crashes, r.killed, r.injured, r.dui)
        for r in state_rows
    }

    results = []
    for county in counties:
        pop = db.execute(
            text("SELECT population FROM counties WHERE code = :c"),
            {"c": county.code},
        ).scalar()

        rows = db.execute(text("""
            SELECT crash_year,
                   COUNT(*) AS crashes,
                   COALESCE(SUM(number_killed), 0) AS killed,
                   COALESCE(SUM(number_injured), 0) AS injured,
                   SUM(CASE WHEN canonical_cause = 'dui' THEN 1 ELSE 0 END) AS dui
            FROM crashes
            WHERE county_code = :c
              AND crash_year < EXTRACT(year FROM CURRENT_DATE)
            GROUP BY crash_year
            HAVING COUNT(*) >= 20
            ORDER BY crash_year
        """), {"c": county.code}).all()

        years = [YearStats(r.crash_year, r.crashes, r.killed, r.injured, r.dui) for r in rows]
        if len(years) >= 3:
            results.append(CountyTrend(county.name, county.code, pop, years, state_years))

    return results


# ---------------------------------------------------------------------------
# Analysis helpers
# ---------------------------------------------------------------------------

def _yoy(a: int, b: int) -> float:
    """Percent change from a to b."""
    return round((b - a) / a * 100, 1) if a > 0 else 0


def _find_peak(years: list[YearStats]) -> YearStats:
    return max(years, key=lambda y: y.crashes)


def _find_trough(years: list[YearStats]) -> YearStats:
    return min(years, key=lambda y: y.crashes)


def _pandemic_impact(years: list[YearStats]) -> dict | None:
    """Analyze 2019→2020 drop and recovery shape."""
    by_yr = {y.year: y for y in years}
    y19, y20 = by_yr.get(2019), by_yr.get(2020)
    if not y19 or not y20:
        return None

    drop_pct = _yoy(y19.crashes, y20.crashes)
    if abs(drop_pct) < 3:
        return None

    # Recovery: find first year that matched or exceeded 2019
    recovery_year = None
    for y in years:
        if y.year > 2020 and y.crashes >= y19.crashes * 0.95:
            recovery_year = y.year
            break

    # Check 2021
    y21 = by_yr.get(2021)
    bounce = _yoy(y20.crashes, y21.crashes) if y21 else None

    return {
        "drop_pct": drop_pct,
        "y19_crashes": y19.crashes,
        "y20_crashes": y20.crashes,
        "bounce_pct": bounce,
        "recovery_year": recovery_year,
        "y21_crashes": y21.crashes if y21 else None,
    }


def _fatality_divergence(years: list[YearStats]) -> dict | None:
    """Check if fatality rate moved independently of crash volume."""
    if len(years) < 5:
        return None

    early = years[:3]
    late = years[-3:]
    early_rate = sum(y.fatality_rate for y in early) / 3
    late_rate = sum(y.fatality_rate for y in late) / 3
    early_vol = sum(y.crashes for y in early) / 3
    late_vol = sum(y.crashes for y in late) / 3

    vol_change = _yoy(int(early_vol), int(late_vol))
    rate_change = late_rate - early_rate

    # Interesting if rate moved opposite to volume, or rate changed a lot
    if abs(rate_change) > 0.3:
        return {
            "early_rate": round(early_rate, 2),
            "late_rate": round(late_rate, 2),
            "rate_change": round(rate_change, 2),
            "vol_change": vol_change,
            "early_period": f"{early[0].year}-{early[-1].year}",
            "late_period": f"{late[0].year}-{late[-1].year}",
        }
    return None


def _state_divergence(trend: CountyTrend) -> dict | None:
    """Check if county trend diverges from statewide."""
    if len(trend.years) < 5:
        return None

    # Compare recent 3-year change
    recent = trend.years[-3:]
    older = trend.years[-6:-3] if len(trend.years) >= 6 else trend.years[:3]

    county_change = _yoy(
        sum(y.crashes for y in older),
        sum(y.crashes for y in recent),
    )

    # Same period statewide
    recent_yrs = [y.year for y in recent]
    older_yrs = [y.year for y in older]
    state_recent = sum(trend.state_years[yr].crashes for yr in recent_yrs if yr in trend.state_years)
    state_older = sum(trend.state_years[yr].crashes for yr in older_yrs if yr in trend.state_years)
    state_change = _yoy(state_older, state_recent) if state_older > 0 else 0

    diff = county_change - state_change
    if abs(diff) > 8:
        return {
            "county_change": county_change,
            "state_change": state_change,
            "divergence": round(diff, 1),
            "period": f"{older[0].year}-{recent[-1].year}",
            "direction": "outpacing" if county_change > state_change else "improving faster than",
        }
    return None


def _long_run(years: list[YearStats]) -> dict:
    """Overall trajectory."""
    first_3 = years[:3]
    last_3 = years[-3:]
    change = _yoy(
        sum(y.crashes for y in first_3) // 3,
        sum(y.crashes for y in last_3) // 3,
    )
    return {
        "change_pct": change,
        "first_year": years[0].year,
        "last_year": years[-1].year,
        "first_avg": sum(y.crashes for y in first_3) // 3,
        "last_avg": sum(y.crashes for y in last_3) // 3,
        "span": years[-1].year - years[0].year,
    }


def _dui_trend(years: list[YearStats]) -> dict | None:
    """Check for significant DUI trend."""
    dui_years = [y for y in years if y.dui > 0]
    if len(dui_years) < 4:
        return None

    early = dui_years[:3]
    late = dui_years[-3:]
    early_pct = sum(y.dui_pct for y in early) / 3
    late_pct = sum(y.dui_pct for y in late) / 3
    shift = late_pct - early_pct

    if abs(shift) > 1.5:
        return {
            "early_pct": round(early_pct, 1),
            "late_pct": round(late_pct, 1),
            "shift": round(shift, 1),
            "early_period": f"{early[0].year}-{early[-1].year}",
            "late_period": f"{late[0].year}-{late[-1].year}",
        }
    return None


# ---------------------------------------------------------------------------
# Narrative composer — picks the most interesting story
# ---------------------------------------------------------------------------

def compose_trend(trend: CountyTrend) -> str:
    """Analyze data patterns and compose a unique trend narrative."""
    name = trend.name
    years = trend.years
    peak = _find_peak(years)
    trough = _find_trough(years)
    lr = _long_run(years)
    pandemic = _pandemic_impact(years)
    fat_div = _fatality_divergence(years)
    state_div = _state_divergence(trend)
    dui = _dui_trend(years)
    latest = years[-1]

    sentences = []

    # Lead with the most interesting finding
    if pandemic and abs(pandemic["drop_pct"]) > 15:
        sentences.append(
            f"The pandemic reshaped driving in {name} County: crashes plunged "
            f"{abs(pandemic['drop_pct'])}% from {pandemic['y19_crashes']:,} in 2019 "
            f"to {pandemic['y20_crashes']:,} in 2020."
        )
        if pandemic["recovery_year"]:
            sentences.append(
                f"Volume didn't recover to pre-pandemic levels until {pandemic['recovery_year']}."
            )
        elif pandemic["bounce_pct"] and pandemic["bounce_pct"] > 10:
            sentences.append(
                f"A sharp {pandemic['bounce_pct']}% rebound in 2021 "
                f"({pandemic['y21_crashes']:,} crashes) signaled drivers returning "
                f"to the road, though patterns haven't fully normalized."
            )
    elif state_div and abs(state_div["divergence"]) > 12:
        if state_div["county_change"] > state_div["state_change"]:
            sentences.append(
                f"While California's crash volume shifted {state_div['state_change']:+.1f}% "
                f"over {state_div['period']}, {name} County moved {state_div['county_change']:+.1f}% "
                f"— growing faster than the state as a whole."
            )
        else:
            sentences.append(
                f"{name} County has been improving faster than the state: crashes "
                f"shifted {state_div['county_change']:+.1f}% over {state_div['period']}, "
                f"compared to {state_div['state_change']:+.1f}% statewide."
            )
    elif abs(lr["change_pct"]) > 20:
        direction = "declined" if lr["change_pct"] < 0 else "increased"
        sentences.append(
            f"Over {lr['span']} years of data, {name} County's annual crash count has "
            f"{direction} {abs(lr['change_pct'])}% — from an average of {lr['first_avg']:,} "
            f"in the early years to {lr['last_avg']:,} recently."
        )
    else:
        sentences.append(
            f"{name} County recorded {latest.crashes:,} crashes in {latest.year}, "
            f"with {latest.killed} fatalities and {latest.injured:,} injuries."
        )

    # Add the second-most interesting finding
    if fat_div and len(sentences) < 3:
        if fat_div["rate_change"] > 0:
            sentences.append(
                f"Despite changes in crash volume, the fatality rate has crept up from "
                f"{fat_div['early_rate']}% ({fat_div['early_period']}) to "
                f"{fat_div['late_rate']}% ({fat_div['late_period']}) — each crash "
                f"is becoming slightly more likely to be deadly."
            )
        else:
            sentences.append(
                f"The fatality rate has dropped from {fat_div['early_rate']}% "
                f"({fat_div['early_period']}) to {fat_div['late_rate']}% "
                f"({fat_div['late_period']}), suggesting that while crashes still "
                f"happen, they're becoming less lethal — likely due to better vehicle "
                f"safety and faster emergency response."
            )

    if dui and len(sentences) < 3:
        direction = "climbed" if dui["shift"] > 0 else "fallen"
        sentences.append(
            f"DUI involvement has {direction} from {dui['early_pct']}% of crashes "
            f"({dui['early_period']}) to {dui['late_pct']}% ({dui['late_period']})."
        )

    # If we still need more, add peak/trough context
    if len(sentences) < 2:
        if peak.year != trough.year and peak.crashes > trough.crashes * 1.3:
            sentences.append(
                f"The county peaked at {peak.crashes:,} crashes in {peak.year} and "
                f"hit a low of {trough.crashes:,} in {trough.year}."
            )

    return " ".join(sentences[:3])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run() -> int:
    db = SessionLocal()
    try:
        trends = _query_trends(db)
        created = 0
        skipped = 0

        for trend in trends:
            latest_year = trend.years[-1].year

            existing = (
                db.query(CountyInsightCard)
                .filter_by(county_code=trend.code, year=latest_year, angle="trend")
                .first()
            )
            if existing:
                skipped += 1
                continue

            narrative = compose_trend(trend)

            stmt = (
                pg_insert(CountyInsightCard)
                .values(
                    county_code=trend.code,
                    county_name=trend.name,
                    year=latest_year,
                    angle="trend",
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
            logger.info("%s — done", trend.name)

        logger.info("Trend cards: %d created, %d skipped", created, skipped)
        return created
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    total = run()
    print(f"\nDone — {total} trend cards generated.")
