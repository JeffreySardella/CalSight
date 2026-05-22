"""Normalize the freeform `primary_road` field to a canonical highway ID.

The raw column has at least 14 different formats — "RT 5", "I-5 N/B", "US-101",
"SR  99 (SOUTHBOUND)", "STATE ROUTE 99", "HWY-9", "CA-99", etc. — and most of
the data uses the SWITRS "RT N" format which doesn't include the route type.

`extract_route_number()` returns:
  * "I-5", "US-101", "SR-99" when the type is recognizable directly from the
    string OR resolvable via the `ca_highways` lookup (e.g. "RT 5" → "I-5"
    because 5 is a known California Interstate)
  * `None` when the string is a local street, an unknown number, or empty

Numbers are preserved exactly (no zero-padding, no collapsing of three-digit
to two-digit) so "SR-110" stays distinct from "I-110".
"""

from __future__ import annotations

import re

from app.ca_highways import resolve_route

# Order matters — first match wins. Patterns are anchored at the start of the
# string so they can't drift into "BLVD CONNECTING I-5" or other prose.
_TYPED_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^I[-\s]?\s*0*(\d+)\b"), "I-"),
    (re.compile(r"^US[-\s]?HWY\s*0*(\d+)\b"), "US-"),
    (re.compile(r"^US[-\s]?\s*0*(\d+)\b"), "US-"),
    (re.compile(r"^CA[-\s]?\s*0*(\d+)\b"), "SR-"),
    (re.compile(r"^SR[-\s]*0*(\d+)\b"), "SR-"),
    (re.compile(r"^STATE\s+(?:HWY|RTE|ROUTE)\s+0*(\d+)\b"), "SR-"),
    (re.compile(r"^STATE\s+0*(\d+)\b"), "SR-"),
)

# These keep just a bare number, so we look it up in CA_HIGHWAYS to decide
# whether it's an Interstate, US Route, or State Route. Anything not in the
# lookup is treated as "not a highway we can rank by mileage" — returns None.
_AMBIGUOUS_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^RT\s+0*(\d+)\b"),
    re.compile(r"^HWY[-\s]?\s*0*(\d+)\b"),
)


def extract_route_number(primary_road: str | None) -> str | None:
    if not primary_road:
        return None
    s = primary_road.strip().upper()
    if not s:
        return None

    for pattern, prefix in _TYPED_PATTERNS:
        m = pattern.match(s)
        if m:
            return f"{prefix}{int(m.group(1))}"

    for pattern in _AMBIGUOUS_PATTERNS:
        m = pattern.match(s)
        if m:
            hw = resolve_route(int(m.group(1)))
            if hw:
                return hw.canonical_id

    return None
