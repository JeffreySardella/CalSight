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


# ── Trend words vs the yearly series the answer shows ────────────────────
# An answer said pedestrian crashes showed "a modest rebound" over a table
# that fell every year after 2020 (phone audit, 2026-09-22). The check below
# reads the yearly series the answer itself cites (its chart, else lines
# like "2016: 5,704" or "| 2016 | 5,704 |") and flags trend words the numbers
# contradict. Two narrow rules keep false alarms rare:
#   1. a rebound word over a series that never rises again once it starts
#      falling;
#   2. a rise/fall word in a sentence naming two years of the series whose
#      values move the other way ("declined from 2016 to 2023").
# ponytail: one series per answer (the chart's, else the first number on
# each year line); a multi-series table is judged by its first column.

_YEAR_LINE_RE = re.compile(
    r"^[\s>*|-]*\**((?:19|20)\d\d)\**\s*[:|–—-]\s*\**\s*(?!(?:19|20)\d\d\b)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)",
    re.MULTILINE,
)
_REBOUND_RE = re.compile(
    r"\b(rebound\w*|bounc\w* back|uptick|upturn|cre(?:ep|pt)\w* (?:back )?up)\b", re.IGNORECASE
)
_RISE_RE = re.compile(r"\b(ris(?:e|es|en|ing)|rose|increas\w*|climb\w*|grew|grow\w*)\b", re.IGNORECASE)
_FALL_RE = re.compile(r"\b(fell|fall(?:s|en|ing)?|declin\w*|decreas\w*|dropp?\w*)\b", re.IGNORECASE)
_SPAN_RE = re.compile(r"\b((?:19|20)\d\d)\b.{0,40}?\b((?:19|20)\d\d)\b")


def _yearly_series(text: str, chart: dict | None) -> dict[int, float]:
    if chart and isinstance(chart.get("data"), list):
        series: dict[int, float] = {}
        for point in chart["data"]:
            label = str(point.get("label", "")).strip() if isinstance(point, dict) else ""
            value = point.get("value") if isinstance(point, dict) else None
            if not (label.isdigit() and _YEAR_MIN <= int(label) <= _YEAR_MAX):
                series = {}
                break
            if isinstance(value, (int, float)):
                series[int(label)] = float(value)
        if len(series) >= 3:
            return series
    series = {}
    for match in _YEAR_LINE_RE.finditer(text or ""):
        series.setdefault(int(match.group(1)), float(match.group(2).replace(",", "")))
    return series


def trend_word_contradictions(text: str, chart: dict | None = None) -> list[str]:
    """Plain-English notes for each trend word the answer's own series contradicts."""
    series = _yearly_series(text, chart)
    if len(series) < 3:
        return []
    years = sorted(series)
    # Judge the prose, not the year lines the series came from.
    prose = _YEAR_LINE_RE.sub("", text or "")
    notes: list[str] = []

    # A rebound is a rise after a fall.
    steps = list(zip(years, years[1:]))
    first_fall = next((y for p, y in steps if series[y] < series[p]), None)
    rises_after = first_fall is not None and any(
        series[y] > series[p] for p, y in steps if y > first_fall
    )
    rebound = _REBOUND_RE.search(prose)
    if rebound and first_fall is not None and not rises_after:
        notes.append(
            f'The answer says "{rebound.group(0)}", but the yearly figures it shows '
            f"do not rise again after {years[years.index(first_fall) - 1]}."
        )

    for sentence in re.split(r"(?<=[.!?])\s+|\n+", prose):
        span = _SPAN_RE.search(sentence)
        rise, fall = _RISE_RE.search(sentence), _FALL_RE.search(sentence)
        if not span or bool(rise) == bool(fall):
            continue
        a, b = sorted((int(span.group(1)), int(span.group(2))))
        if a == b or a not in series or b not in series or series[a] == series[b]:
            continue
        went_up = series[b] > series[a]
        word = (rise or fall).group(0)
        if went_up != bool(rise):
            notes.append(
                f'The answer says "{word}" for {a} to {b}, but its figures go '
                f"from {series[a]:,.0f} to {series[b]:,.0f}."
            )
    return notes
