"""Numeric verification gate for LLM insight cards.

2026-09-12: Alpine's ``overview`` card said "roughly 20 crashes in 2025" —
live was 68. The LLM invented the number and the generator never re-checked
existing cards, so it never self-healed. Every number a card states must now
be within 2% of a figure that was actually in the prompt.
"""

import etl.generate_llm_cards as mod
from etl.generate_llm_cards import _GUARDRAILS, _generate_verified, unsupported_numbers

_STATS = (
    "total_crashes=68, killed=1, injured=41, fatality_rate=1.47%, "
    "top_causes=speeding(35.3%), dui(12.6%), peak_hour=17:00, population=1,204, "
    "per_100k=5648, rank=58/58, state_total=412,345, county_share=0.02%"
)


def test_numbers_that_match_the_stats_pass():
    narrative = (
        "Alpine County recorded 68 crashes in 2025, ranking 58th of 58 counties; "
        "speeding was cited in 35.3% of them and the peak hour was 17:00."
    )
    assert unsupported_numbers(narrative, _STATS, 2025) == []


def test_fabricated_number_is_flagged():
    narrative = "Alpine County saw roughly 20 crashes in 2025, mostly on Highway 88."
    assert unsupported_numbers(narrative, _STATS, 2025) == [20.0, 88.0]


def test_rounded_percentages_and_near_totals_pass():
    narrative = (
        "About 13% of Alpine's crashes involved DUI and 35% speeding; "
        "the county holds nearly 1,200 residents, so its per-capita rate is 5,650."
    )
    assert unsupported_numbers(narrative, _STATS, 2025) == []


def test_generate_verified_retries_once_then_gives_up(monkeypatch):
    calls = []

    def fake(prompt):
        calls.append(prompt)
        return "Alpine County saw roughly 20 crashes in 2025, a quiet year statewide."

    monkeypatch.setattr(mod, "generate_narrative", fake)
    assert _generate_verified("p", _STATS, 2025, "alpine") is None
    assert len(calls) == 2
    assert calls[1].endswith("Use only the exact figures provided.")


def test_generate_verified_accepts_corrected_retry(monkeypatch):
    answers = iter([
        "Alpine County saw roughly 20 crashes in 2025, a quiet year statewide.",
        "Alpine County recorded 68 crashes in 2025, the fewest of any California county.",
    ])
    monkeypatch.setattr(mod, "generate_narrative", lambda p: next(answers))
    assert _generate_verified("p", _STATS, 2025, "alpine").startswith("Alpine County recorded 68")


def test_guardrails_forbid_unsupplied_comparisons():
    assert "national average" in _GUARDRAILS
    assert "peak hour" in _GUARDRAILS
