"""One-off audit of every county narrative already in the database.

Re-runs the write-time fact check (etl.fact_check) on each non-NULL
``county_insights.narrative``, against the stats context generate_insights
builds for that county-year. Rows written before the narrative gate existed
show up here — Alpine's "27 (39.7%) were caused by speeding" was live on
2026-09-18.

Usage::

    cd backend
    python -m etl.audit_narratives            # report only
    python -m etl.audit_narratives --delete   # clear the failing narratives

``--delete`` sets narrative (and generated_at) to NULL rather than deleting
the row: the structured stats stay, ``/api/insights/{slug}`` already serves
``narrative: null``, and the next generate_insights run refills the row
because ``is_junk_narrative(None)`` is True.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from typing import Callable

from sqlalchemy import text

from app.database import EtlSessionLocal as SessionLocal  # write/DDL role
from app.models import CountyInsight
from etl import generate_insights as gi
from etl.fact_check import CAUSAL_RE, check_fact, numbers_context

# Figures the stored card itself shows — the fallback context for a county-year
# whose crashes have since been reloaded away.
_STORED_FIGURES = (
    "total_crashes", "total_killed", "total_injured", "crash_rate_per_capita",
    "top_cause_pct", "yoy_change_pct", "dui_pct",
)


# A sentence ends at . ! ? — but not at the decimal point in "39.7%".
_SENTENCE_RE = re.compile(r"(?:[^.!?]|\.\d)+[.!?]?")


def offending_phrase(narrative: str) -> str:
    """The sentence holding the causal wording, else the opening of the text.

    The number reasons already name the numbers; the causal reason names only
    the connective, which reads as nonsense without its sentence.
    """
    s = (narrative or "").strip()
    m = CAUSAL_RE.search(s)
    if not m:
        return s[:160]
    for sentence in _SENTENCE_RE.finditer(s):
        if sentence.start() <= m.start() < sentence.end():
            return sentence.group(0).strip()
    return s[:160]


def audit_row(
    narrative: str | None, year: int, context: Callable[[], str],
    current_year: int | None = None,
) -> list[str]:
    """Reasons this narrative should not be served; [] = keep. ``context`` is
    lazy so a NULL narrative costs no queries."""
    if not narrative:
        return []
    return check_fact(narrative, context(), year, current_year)


def _context(db, row: CountyInsight) -> str:
    stats = gi._query_stats(db, row.county_code, row.year)
    if stats is None:
        return numbers_context({k: getattr(row, k) for k in _STORED_FIGURES})
    return gi._stats_parts(stats, gi._query_demographics(db, row.county_code, row.year))


def run(delete: bool = False) -> dict:
    db = SessionLocal()
    try:
        rows = (
            db.query(CountyInsight)
            .filter(CountyInsight.narrative.isnot(None))
            .order_by(CountyInsight.county_code, CountyInsight.year)
            .all()
        )
        names = dict(
            db.execute(text("SELECT code, name FROM counties")).all()
        )

        failing = []
        for r in rows:
            reasons = audit_row(r.narrative, r.year, lambda r=r: _context(db, r))
            if reasons:
                failing.append((r, reasons))

        for r, reasons in failing:
            print(
                f"FAIL {names.get(r.county_code, r.county_code)}/{r.year}: "
                f"{'; '.join(reasons)}\n     {offending_phrase(r.narrative)!r}"
            )

        by_reason = Counter(
            reason.split(":")[0] for _, reasons in failing for reason in reasons
        )
        if delete and failing:
            for r, _ in failing:
                r.narrative = None
                r.generated_at = None
            db.commit()

        summary = {
            "checked": len(rows),
            "failing": len(failing),
            "cleared": len(failing) if delete else 0,
        }
        print("\n=== Narrative audit ===")
        print(f"checked: {summary['checked']} county narratives")
        print(f"failing: {summary['failing']}")
        for reason, n in by_reason.most_common():
            print(f"  {reason}: {n}")
        print(
            f"cleared: {summary['cleared']} (next generate_insights run refills them)"
            if delete
            else "report only — rerun with --delete to clear the failing narratives"
        )
        return summary
    finally:
        db.close()


if __name__ == "__main__":
    run(delete="--delete" in sys.argv[1:])
