"""LLM-powered quality judge for insight cards.

Uses Groq to evaluate each card on a 1-10 scale across 4 criteria:
- Accuracy: Does it sound factually grounded? (not hallucinated-feeling)
- Engagement: Is it interesting? Would someone share this?
- Specificity: Does it use concrete numbers, not vague language?
- Clarity: Is it well-written and easy to understand?

Cards scoring below threshold get deleted. Runs slowly to avoid
rate limits (separate from Ask AI traffic).

Usage:
    python -m etl.judge_insight_cards                  # judge all ungraded
    python -m etl.judge_insight_cards --threshold 5    # delete below 5/10 avg
    python -m etl.judge_insight_cards --sample 100     # judge random 100
    python -m etl.judge_insight_cards --delay 2        # faster (2s between)
"""

from __future__ import annotations

import argparse
import json
import logging
import time

from sqlalchemy import func

from app.database import EtlSessionLocal as SessionLocal
from app.llm import generate_narrative
from app.models import CountyInsightCard

logger = logging.getLogger(__name__)

JUDGE_PROMPT = """You are a quality judge for data insight cards about California crash statistics.

Rate this card on 4 criteria, each 1-10:
- accuracy: Does it sound factually grounded and data-driven?
- engagement: Is it interesting? Would a reader share this?
- specificity: Does it use concrete numbers and comparisons?
- clarity: Is it well-written and easy to understand?

Card: "{narrative}"
County: {county}, Year: {year}, Angle: {angle}

Respond ONLY with JSON, no other text:
{{"accuracy": N, "engagement": N, "specificity": N, "clarity": N, "avg": N.N}}"""


def _parse_scores(response: str) -> dict | None:
    """Extract JSON scores from LLM response."""
    try:
        text = response.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(text[start:end])
            if all(k in data for k in ("accuracy", "engagement", "specificity", "clarity")):
                avg = sum(data[k] for k in ("accuracy", "engagement", "specificity", "clarity")) / 4
                data["avg"] = round(avg, 1)
                return data
    except (json.JSONDecodeError, KeyError, TypeError):
        pass
    return None


def run(
    threshold: float = 4.0,
    sample: int | None = None,
    delay: int = 3,
    dry_run: bool = False,
) -> dict:
    """Judge cards and delete low-quality ones."""
    db = SessionLocal()
    try:
        query = db.query(CountyInsightCard)
        if sample:
            query = query.order_by(func.random()).limit(sample)
        else:
            query = query.order_by(CountyInsightCard.id)

        cards = query.all()
        if not cards:
            logger.info("No cards to judge.")
            return {"total": 0}

        judged = 0
        deleted = 0
        errors = 0
        scores = []

        for card in cards:
            prompt = JUDGE_PROMPT.format(
                narrative=card.narrative[:500],
                county=card.county_name,
                year=card.year,
                angle=card.angle,
            )

            try:
                response = generate_narrative(prompt)
                result = _parse_scores(response)

                if result:
                    scores.append(result["avg"])
                    judged += 1

                    if result["avg"] < threshold:
                        if dry_run:
                            logger.info(
                                "WOULD DELETE %s/%d/%s — avg=%.1f %s",
                                card.county_name, card.year, card.angle,
                                result["avg"], result,
                            )
                        else:
                            db.delete(card)
                            db.commit()
                            deleted += 1
                            logger.info(
                                "DELETED %s/%d/%s — avg=%.1f",
                                card.county_name, card.year, card.angle,
                                result["avg"],
                            )
                    else:
                        logger.info(
                            "PASS %s/%d/%s — avg=%.1f",
                            card.county_name, card.year, card.angle,
                            result["avg"],
                        )
                else:
                    errors += 1

            except Exception as exc:
                errors += 1
                logger.warning("Judge error on %s/%d/%s: %s", card.county_name, card.year, card.angle, exc)

            time.sleep(delay)

            if judged % 50 == 0 and judged > 0:
                avg = sum(scores) / len(scores)
                logger.info("Progress: %d judged, %d deleted, avg=%.1f", judged, deleted, avg)

        avg_score = sum(scores) / len(scores) if scores else 0
        logger.info("=== JUDGE REPORT ===")
        logger.info("Judged: %d, Deleted: %d, Errors: %d", judged, deleted, errors)
        logger.info("Average score: %.1f / 10", avg_score)
        logger.info("Score distribution:")
        for bucket in [(9, 10, "excellent"), (7, 8.9, "good"), (5, 6.9, "fair"), (0, 4.9, "poor")]:
            lo, hi, label = bucket
            count = sum(1 for s in scores if lo <= s <= hi)
            logger.info("  %s (%.0f-%.0f): %d", label, lo, hi, count)

        return {
            "judged": judged,
            "deleted": deleted,
            "errors": errors,
            "avg_score": round(avg_score, 1),
        }
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=4.0)
    parser.add_argument("--sample", type=int, default=None)
    parser.add_argument("--delay", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(threshold=args.threshold, sample=args.sample, delay=args.delay, dry_run=args.dry_run)
