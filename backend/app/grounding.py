"""Numeric-grounding heuristic for Ask AI answers (#293).

"grounded" used to mean "at least one tool executed successfully" — but a
model can call a tool, ignore the result, and hallucinate numbers anyway.
This module adds a cheap cross-check: extract the distinctive numeric tokens
(counts, percentages, rates) from the successful tool results and verify the
final answer shares at least one of them.

Deliberately conservative — we only downgrade when the tool results DID
contain distinctive numbers and the answer shares NONE of them. Years
(1900-2100) and small integers (< 10) are ignored on both sides because they
appear by chance far too often ("top 5 counties in 2023") to be evidence of
grounding or of its absence. Rounding by the model ("about 8,200" for 8,234)
can still produce a false negative; that trade-off is accepted to keep the
check dependency-free and O(len(text)).
"""

from __future__ import annotations

import re

# Comma-grouped numbers first ("8,234", "1,002,455.5") so "8,234" is one
# token instead of "8" + "234"; plain ints/decimals otherwise. Ordered
# alternation means "2019, 2020" still splits into two year tokens.
_NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")

# Integers in this range are treated as years, not data points.
_YEAR_MIN = 1900
_YEAR_MAX = 2100

# Integers below this are too common to be distinctive ("top 5", "3 counties").
_SMALL_INT_CUTOFF = 10


def extract_distinctive_numbers(text: str) -> set[float]:
    """Extract numeric values from ``text`` that are unlikely to appear by chance.

    Values are normalized to floats so "8,234", "8234" and "8234.0" all
    compare equal. Excluded as non-distinctive:
    - integers < 10 (list positions, small counts)
    - integers 1900-2100 (years)
    Decimals are always kept — "3.2" is a rate/percentage, not a coincidence.
    """
    numbers: set[float] = set()
    for match in _NUMBER_RE.finditer(text or ""):
        token = match.group(0).replace(",", "")
        try:
            value = float(token)
        except ValueError:  # pragma: no cover - regex guarantees parseability
            continue
        if value.is_integer():
            int_value = int(value)
            if int_value < _SMALL_INT_CUTOFF:
                continue
            if _YEAR_MIN <= int_value <= _YEAR_MAX:
                continue
        numbers.add(value)
    return numbers


def answer_cites_tool_numbers(answer: str, tool_results: list[str]) -> bool:
    """Does ``answer`` share at least one distinctive number with ``tool_results``?

    Returns True (i.e. "do not downgrade") when the tool results contain no
    distinctive numbers at all — there is nothing to cross-check against, and
    a text-only tool result ("no data for that county") legitimately produces
    a number-free answer.
    """
    tool_numbers: set[float] = set()
    for result in tool_results:
        tool_numbers |= extract_distinctive_numbers(result)
    if not tool_numbers:
        return True
    return bool(extract_distinctive_numbers(answer) & tool_numbers)
