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
    "collision", "single",
)
_NOT_THE_NOUN = "".join(rf"(?<!\b{w} )" for w in _NOUN_MODIFIERS)
_NOUN_COMPOUNDS = ("of", "categor\\w*", "breakdown", "label", "labels",
                   "code", "codes", "column", "field", "mix", "split")
_NOT_A_COMPOUND = rf"(?!\s+(?:{'|'.join(_NOUN_COMPOUNDS)})\b)"

# A hedge doesn't make a cause claim supportable: "emptier roads may have
# encouraged riskier driving" and "could reflect remote work" explain a number
# the data only counts. The shape is a hedge word, at most two auxiliaries,
# then an explaining verb or noun. "May" the month and "may change as reports
# arrive" have no explaining word after them and pass. Kept linear-time for
# CodeQL: every alternative is a literal stem, and the only repeat is bounded.
_HEDGES = "may|might|could|would|likely|probably|possibly|perhaps|presumably"
_HEDGE_AUX = "have|has|had|be|been|also|well|partly|largely|mostly"
_EXPLAINERS = (
    r"reflect\w*|contribut\w*|encourag\w*|fuel\w*|driven|spur\w*|prompt\w*"
    r"|trigger\w*|stem\w*|explain\w*|attribut\w*|linked|tied|influenc\w*"
    r"|play(?:s|ed)?\s+a\s+(?:role|part)"
    r"|(?:an?\s+)?(?:factors?|reasons?|culprits?|explanations?)"
    r"|(?:the|a|an)\s+(?:result|product|consequence|reflection|sign)\s+of"
)
_HEDGED_CAUSE = rf"(?:{_HEDGES})(?:\s+(?:{_HEDGE_AUX})){{0,2}}\s+(?:{_EXPLAINERS})"

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
    rf"|{_HEDGED_CAUSE}"
    r")\b",
    re.IGNORECASE,
)


# "1,204 crashes resulted in injuries" tallies an outcome; it is not a claim
# about why anything happened. It only counts as a tally when a crash noun is
# the subject AND a harm is the object — "speeding resulted in 27 deaths" and
# "more crashes resulted in higher premiums" both stay causal.
_OUTCOME_TALLY_RE = re.compile(
    r"\b(?:crash(?:es)?|collisions?|incidents?|wrecks?|accidents?)"
    r"(?:\s*\([^)]*\))?\s+(?:(?:that|which)\s+)?result(?:s|ed)? in\s+"
    r"(?:[\w,.%-]+\s+){0,4}?"
    r"(?:injur\w*|deaths?|fatalit\w*|damage|bent metal)\b",
    re.IGNORECASE,
)


def find_causal(text: str) -> re.Match | None:
    """First causal connective in ``text``, ignoring crash-outcome tallies.

    Tallies are blanked rather than removed so the match offsets still point
    into the original text.
    """
    return CAUSAL_RE.search(_OUTCOME_TALLY_RE.sub(lambda m: " " * len(m.group(0)), text))


def _numbers(s: str) -> list[float]:
    return [float(m.replace(",", "")) for m in _NUM_RE.findall(s)]


def allowed_numbers(stats_str: str, year: int) -> set[float]:
    """Every figure the prompt supplied, plus cheap derivations a card may state.

    Derivations: per-day / per-week / per-month / minutes-between for the three
    totals, and floor/ceil of everything so "13%" passes for 12.6%.
    """
    # 1,000 is the rate unit itself ("13.5 deaths per 1,000 crashes").
    nums = set(_numbers(stats_str)) | {float(year), 58.0, 1000.0}
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


# A named collision type or crash cause is a factual claim just like a number:
# the stats the card was written from must carry it. 2026-09-22: the live
# Fresno card blamed "head-on collisions from unsafe passing"; no figure it was
# given (and nothing the site shows) mentions either. Each entry is a reader's
# phrasing and the stats keys that back it. Collision types never reach the
# prompts, so naming one always fails. Deliberately narrow: generic wording
# ("rural roads", "higher speeds") is not a named cause and is left alone.
_NAMED_CLAIMS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("head-on", r"\bhead[\s-]+on\b", ("head_on",)),
    ("rear-end", r"\brear[\s-]+end", ("rear_end",)),
    ("broadside", r"\bbroadside|\bt[\s-]?bone", ("broadside",)),
    ("sideswipe", r"side[\s-]?swip", ("sideswipe",)),
    ("rollover", r"roll[\s-]?over|overturn", ("overturn",)),
    ("unsafe passing", r"(?:unsafe|improper|illegal)\s+passing", ("passing",)),
    ("wrong-way", r"\bwrong[\s-]+way\b", ("wrong_way", "wrong_side")),
    ("dui", r"\bDUI\b|drunk|alcohol|intoxicat|impaired", ("dui",)),
    ("speeding", r"speeding|(?:unsafe|excessive)\s+speed", ("speed",)),
    ("red-light running", r"\bred[\s-]+lights?\b|signal\s+violation", ("signal_violation",)),
    ("lane change", r"lane[\s-]+chang", ("lane_change",)),
    ("right of way", r"right[\s-]+of[\s-]+way|fail\w*\s+to\s+yield", ("right_of_way",)),
    ("tailgating", r"tailgat|following\s+too\s+clos", ("following_too_close",)),
    ("distraction", r"distract|cell\s*phone|texting", ("distract",)),
)
_NAMED_CLAIM_RES = [(label, re.compile(pat, re.IGNORECASE), keys) for label, pat, keys in _NAMED_CLAIMS]

# The site states deaths relative to crashes in one unit: per 1,000 crashes.
# "1.2 per 100 crashes" / "a fatality rate of 1.35%" read as a different
# number from the report card's 13.5 for the same data.
_WRONG_RATE_UNIT_RE = re.compile(
    r"per\s+100\s+(?:crashes|collisions)"
    r"|(?:fatality|death)\s+rate\s+(?:of\s+|at\s+|was\s+|is\s+)?(?:just\s+|about\s+)?\d+(?:\.\d+)?\s*%",
    re.IGNORECASE,
)


def check_claims(text: str, stats_str: str) -> list[str]:
    """Named causes/collision types absent from ``stats_str``, and off-unit
    death rates; [] = pass. Used on LLM text and county-card templates."""
    stats = stats_str.lower()
    reasons = []
    named = [
        label for label, rx, keys in _NAMED_CLAIM_RES
        if rx.search(text) and not any(k in stats for k in keys)
    ]
    if named:
        reasons.append(f"causes not in stats: {named}")
    if m := _WRONG_RATE_UNIT_RE.search(text):
        reasons.append(f"death rate not per 1,000 crashes: {m.group(0)!r}")
    return reasons


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
    if m := find_causal(text):
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
