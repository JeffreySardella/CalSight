"""One-off audit of every fun fact already in the database.

Re-runs the write-time fact check (etl.fact_check) on each ``fun_fact%`` row
in county_insight_cards and statewide_insights, against a stats context
rebuilt the way the generators build it. Rows written before the check
existed — or by no generator at all (the Los Angeles ``fun_fact`` row with an
invented Sepulveda Pass traffic figure) — show up here.

Usage::

    cd backend
    python -m etl.audit_fun_facts            # report only
    python -m etl.audit_fun_facts --delete   # delete the failing rows

After --delete, the daily ``fun_facts`` job re-creates the template facts that
now pass; LLM fun facts come back on the next generate_llm_cards run.
"""

from __future__ import annotations

import sys
from collections import Counter
from typing import Callable

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import CountyInsightCard, StatewideInsight
from etl import generate_county_cards as cc
from etl import generate_fun_facts as ff
from etl import generate_llm_cards as llm
from etl.fact_check import check_fact

COUNTY_ANGLES = (
    set(ff.COUNTY_ANGLES)
    | {a for a in cc.ANGLES if a.startswith("fun_fact")}
    | {a for a in llm.ANGLE_PROMPTS if a.startswith("fun_fact")}
)
STATEWIDE_ANGLES = (
    set(ff.STATEWIDE_ANGLES)
    | {a for a in llm.STATEWIDE_ANGLE_PROMPTS if a.startswith("fun_fact")}
)


def audit_row(
    narrative: str | None, angle: str, year: int, known_angles: set[str],
    context: Callable[[], str], current_year: int | None = None,
) -> list[str]:
    """Reasons this row should not be served; [] = keep. ``context`` is lazy
    so an orphan angle costs no queries."""
    if angle not in known_angles:
        return [f"angle {angle!r} is not produced by any generator"]
    return check_fact(narrative or "", context(), year, current_year)


def _county_context(db, code: int, year: int) -> str:
    """Union of every generator's stats for this county-year — a figure any
    of them supplied is a real figure."""
    parts = []
    if s := ff._query_county_stats(db, code, year):
        parts.append(ff.fact_context(s))
    if d := cc._query_full(db, code, year):
        parts.append(cc.fact_context(d))
    if stats_str := llm._build_stats_string(db, code, year):
        parts.append(stats_str)
    return ", ".join(parts)


def _statewide_context(db, year: int) -> str:
    parts = []
    if s := ff._query_statewide_stats(db, year):
        parts.append(ff.fact_context(s))
    if built := llm._build_statewide_stats_string(db, year):
        parts.append(built[0])
    return ", ".join(parts)


def run(delete: bool = False) -> dict:
    db = SessionLocal()
    cache: dict[tuple, str] = {}

    def cached(key, fn):
        if key not in cache:
            cache[key] = fn()
        return cache[key]

    try:
        county_rows = (
            db.query(CountyInsightCard)
            .filter(CountyInsightCard.angle.like("fun_fact%"))
            .order_by(CountyInsightCard.county_name, CountyInsightCard.year)
            .all()
        )
        state_rows = (
            db.query(StatewideInsight)
            .filter(StatewideInsight.angle.like("fun_fact%"))
            .order_by(StatewideInsight.year)
            .all()
        )

        failing = []
        for r in county_rows:
            reasons = audit_row(
                r.narrative, r.angle, r.year, COUNTY_ANGLES,
                lambda r=r: cached(("c", r.county_code, r.year),
                                   lambda: _county_context(db, r.county_code, r.year)),
            )
            if reasons:
                failing.append((r, f"county {r.county_name}/{r.year}/{r.angle}", reasons))
        for r in state_rows:
            reasons = audit_row(
                r.narrative, r.angle, r.year, STATEWIDE_ANGLES,
                lambda r=r: cached(("s", r.year), lambda: _statewide_context(db, r.year)),
            )
            if reasons:
                failing.append((r, f"statewide {r.year}/{r.angle}", reasons))

        for _, label, reasons in failing:
            print(f"FAIL {label}: {'; '.join(reasons)}")

        by_reason = Counter(
            reason.split(":")[0] if not reason.startswith("angle") else "unknown angle"
            for _, _, reasons in failing for reason in reasons
        )
        if delete and failing:
            for row, _, _ in failing:
                db.delete(row)
            db.commit()

        summary = {
            "county_checked": len(county_rows),
            "statewide_checked": len(state_rows),
            "failing": len(failing),
            "deleted": len(failing) if delete else 0,
        }
        print("\n=== Fun-fact audit ===")
        print(f"checked: {summary['county_checked']} county + {summary['statewide_checked']} statewide rows")
        print(f"failing: {summary['failing']}")
        for reason, n in by_reason.most_common():
            print(f"  {reason}: {n}")
        print(
            f"deleted: {summary['deleted']}" if delete
            else "report only — rerun with --delete to remove the failing rows"
        )
        return summary
    finally:
        db.close()


if __name__ == "__main__":
    run(delete="--delete" in sys.argv[1:])
