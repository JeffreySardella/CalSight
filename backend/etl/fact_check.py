"""Write-time fact check shared by every insight-card generator.

A card may only state figures that are in (or cheaply derived from) the stats
it was built from, and a fun fact may only state associations — never causes.
2026-09-18: live fun facts said "The pandemic year likely played a role" and
compared a partial 2026 to a full 2025 ("Crash volume dropped 38.7%").
"""

from __future__ import annotations

import datetime
import math
import re

_NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")

# "cause" is also the noun for a SWITRS crash-cause category, so the old
# `caus\w*` flagged honest category sentences ("incidents classified under
# other causes represent the largest share", "the leading cause of fatal
# crashes"). The cause family now matches only where it reads as a verb:
# "caused"/"caused by"/"causing" always do, and bare "cause"/"causes" does
# unless it is the category noun — which it is when a determiner, quantifier,
# ranking adjective or preposition sits in front of it ("the top cause", "by
# cause", "unknown causes") or a noun-compound word follows it ("cause
# category", "cause of"). Everything else is transitive: "speeding causes
# crashes", "rain can cause a spike".
_NOUN_MODIFIERS = (
    "the", "a", "an", "its", "their", "our", "that", "this", "these", "those",
    "other", "top", "leading", "main", "primary", "same", "common", "each",
    "every", "any", "all", "no", "most", "some", "such", "many", "several",
    "two", "three", "known", "unknown", "likely", "probable", "possible",
    "root", "major", "minor", "frequent", "specific", "underlying",
    "contributing", "reported", "recorded", "listed", "by", "crash",
    "collision",
)
_NOT_THE_NOUN = "".join(rf"(?<!\b{w} )" for w in _NOUN_MODIFIERS)
_NOUN_COMPOUNDS = ("of", "categor\\w*", "breakdown", "label", "labels",
                   "code", "codes", "column", "field", "mix", "split")
_NOT_A_COMPOUND = rf"(?!\s+(?:{'|'.join(_NOUN_COMPOUNDS)})\b)"

CAUSAL_RE = re.compile(
    r"\b(?:"
    r"because"
    r"|due to"
    r"|caused by|caused|causing"
    rf"|{_NOT_THE_NOUN}caus(?:e|es)\b{_NOT_A_COMPOUND}"
    r"|leads? to|led to"
    r"|result(?:s|ed)? in"
    r"|likely played"
    r"|driven by"
    r"|thanks to"
    r")\b",
    re.IGNORECASE,
)


def _numbers(s: str) -> list[float]:
    return [float(m.replace(",", "")) for m in _NUM_RE.findall(s)]


def allowed_numbers(stats_str: str, year: int) -> set[float]:
    """Every figure the prompt supplied, plus cheap derivations a card may state.

    Derivations: per-day / per-week / per-month / minutes-between for the three
    totals, and floor/ceil of everything so "13%" passes for 12.6%.
    """
    nums = set(_numbers(stats_str)) | {float(year), 58.0}
    # Both spellings: the fun-fact context writes "killed=/injured=", the
    # county-narrative context writes "total_killed=/total_injured=". Matching
    # only the short form silently dropped the derivations for deaths and
    # injuries from every narrative ("about 365 deaths a month").
    for key in ("crashes", "killed", "injured"):
        m = re.search(rf"\b(?:total_)?{key}=([\d,]+)", stats_str)
        if m and (n := float(m.group(1).replace(",", ""))):
            nums |= {n / 365, n / 52, n / 12, n / 7, 525_600 / n, 8_760 / n}
    for n in list(nums):
        nums |= {float(math.floor(n)), float(math.floor(n) + 1)}
    return nums


def unsupported_numbers(narrative: str, stats_str: str, year: int) -> list[float]:
    """Numbers in ``narrative`` (10..10M, not a year) with no supplied figure within 2%."""
    allowed = allowed_numbers(stats_str, year)
    return [
        n for n in _numbers(narrative)
        if 10 <= n <= 10_000_000
        and not (n.is_integer() and 1990 <= n <= 2100)
        and not any(abs(n - a) <= 0.02 * a for a in allowed)
    ]


def check_fact(
    text: str, stats_str: str, year: int, current_year: int | None = None,
) -> list[str]:
    """Reasons ``text`` can't be published as a fact for ``year``; [] = pass."""
    if current_year is None:
        current_year = datetime.date.today().year
    reasons = []
    if year >= current_year:
        reasons.append(f"year {year} is not complete yet")
    if bad := unsupported_numbers(text, stats_str, year):
        reasons.append(f"figures not in stats: {bad}")
    if m := CAUSAL_RE.search(text):
        reasons.append(f"causal language: {m.group(0)!r}")
    return reasons


def numbers_context(*objs) -> str:
    """Flatten every number in dicts/lists/tuples into a stats string.

    The template generators work from dicts, not a prompt string; this turns
    that dict (plus any derived figures the templates print) into something
    ``check_fact`` can read. Keys are skipped on purpose — day/month/hour
    indexes would otherwise whitelist small integers.
    """
    out: list[str] = []

    def walk(o):
        if isinstance(o, bool) or o is None:
            return
        if isinstance(o, (int, float)):
            out.append(repr(float(o)))
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, (list, tuple, set)):
            for v in o:
                walk(v)

    for o in objs:
        walk(o)
    return " ".join(out)
