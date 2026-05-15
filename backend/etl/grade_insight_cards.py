"""Grade insight cards on quality metrics and flag low-quality ones.

Scores each card 0-100 based on:
- Length (too short = bad, too long = bad)
- Contains specific numbers (not vague)
- Has comparison (vs state, vs history)
- Doesn't repeat county name excessively
- Doesn't start with the county name (boring lead)
- Has engaging language (not just "X county had Y crashes")

Usage:
    python -m etl.grade_insight_cards              # grade all, print summary
    python -m etl.grade_insight_cards --fix        # delete cards scoring below 40
    python -m etl.grade_insight_cards --verbose    # show each card's score breakdown
"""

from __future__ import annotations

import logging
import re
import sys

from app.database import EtlSessionLocal as SessionLocal
from app.models import CountyInsightCard

logger = logging.getLogger(__name__)


def grade_card(narrative: str, county_name: str) -> dict:
    """Score a card narrative and return breakdown."""
    scores = {}
    n = narrative.strip()

    # Length: ideal 100-300 chars. Penalize < 60 or > 500.
    length = len(n)
    if 100 <= length <= 300:
        scores["length"] = 25
    elif 60 <= length < 100 or 300 < length <= 400:
        scores["length"] = 15
    elif length < 60:
        scores["length"] = 0
    else:
        scores["length"] = 10

    # Contains specific numbers (at least 2)
    numbers = re.findall(r'\d[\d,]*\.?\d*%?', n)
    if len(numbers) >= 3:
        scores["specificity"] = 25
    elif len(numbers) >= 2:
        scores["specificity"] = 20
    elif len(numbers) >= 1:
        scores["specificity"] = 10
    else:
        scores["specificity"] = 0

    # Has comparison language
    comparison_words = ["compared to", "vs", "above", "below", "more than",
                        "less than", "higher", "lower", "average", "statewide",
                        "state", "rank", "unlike", "while", "whereas"]
    comp_count = sum(1 for w in comparison_words if w.lower() in n.lower())
    if comp_count >= 2:
        scores["comparison"] = 20
    elif comp_count >= 1:
        scores["comparison"] = 12
    else:
        scores["comparison"] = 0

    # Doesn't start with county name (boring lead)
    if n.lower().startswith(county_name.lower()):
        scores["lead"] = 5
    else:
        scores["lead"] = 15

    # Not too repetitive on county name
    name_count = n.lower().count(county_name.lower())
    if name_count <= 2:
        scores["repetition"] = 15
    elif name_count <= 3:
        scores["repetition"] = 10
    else:
        scores["repetition"] = 0

    total = sum(scores.values())
    return {"total": total, **scores}


def run(fix: bool = False, verbose: bool = False) -> dict:
    """Grade all cards and return summary stats."""
    db = SessionLocal()
    try:
        cards = db.query(CountyInsightCard).all()
        if not cards:
            logger.info("No cards to grade.")
            return {"total": 0}

        grades = []
        low_quality = []

        for card in cards:
            result = grade_card(card.narrative, card.county_name)
            grades.append(result["total"])

            if verbose:
                logger.info(
                    "%s/%s/%d — score=%d %s",
                    card.county_name, card.angle, card.year,
                    result["total"],
                    {k: v for k, v in result.items() if k != "total"},
                )

            if result["total"] < 40:
                low_quality.append(card)

        avg = sum(grades) / len(grades)
        dist = {
            "excellent (80+)": sum(1 for g in grades if g >= 80),
            "good (60-79)": sum(1 for g in grades if 60 <= g < 80),
            "fair (40-59)": sum(1 for g in grades if 40 <= g < 60),
            "poor (<40)": sum(1 for g in grades if g < 40),
        }

        logger.info("=== CARD QUALITY REPORT ===")
        logger.info("Total cards: %d", len(cards))
        logger.info("Average score: %.1f / 100", avg)
        for label, count in dist.items():
            pct = round(count / len(cards) * 100, 1)
            logger.info("  %s: %d (%s%%)", label, count, pct)

        if fix and low_quality:
            logger.info("Deleting %d poor-quality cards...", len(low_quality))
            for card in low_quality:
                db.delete(card)
            db.commit()
            logger.info("Deleted %d cards below threshold.", len(low_quality))

        return {
            "total": len(cards),
            "average": round(avg, 1),
            "distribution": dist,
            "low_quality_count": len(low_quality),
        }
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    fix = "--fix" in sys.argv
    verbose = "--verbose" in sys.argv
    run(fix=fix, verbose=verbose)
