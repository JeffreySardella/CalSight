"""City name normalization + lookup helpers shared by the seeder, ETL, and API.

The raw `crashes.city_name` field is freeform text from CCRS/SWITRS reporting
agencies and arrives in many shapes: "OAKLAND", "Oakland", "Oakland, CA",
"San José", "City of Fresno". `normalize_name()` collapses all of those to a
single key we can match against the `cities.name_normalized` column.
"""

from __future__ import annotations

import re
import unicodedata

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")

# Suffixes/prefixes that often appear in freeform reporting data but aren't part
# of the canonical place name.
_STRIP_SUFFIXES = (
    ", ca",
    ", california",
    " ca",
)
_STRIP_PREFIXES = (
    "city of ",
    "town of ",
)
# Place-type words used by the Census in their official names. We strip these
# from BOTH the canonical name (when seeding) and incoming city_name values so
# "Mountain View city" matches "mountain view".
_STRIP_TYPE_WORDS = (" city", " town", " cdp")


def normalize_name(raw: str | None) -> str:
    """Lowercase + ASCII-fold + strip punctuation/CA-suffix → matching key.

    Returns an empty string for None or empty input; callers should treat that
    as "no city" (NULL city_id).
    """
    if not raw:
        return ""
    # NFKD decomposes accented chars; encoding to ASCII with errors="ignore"
    # drops the diacritics. "San José" → "san jose".
    s = unicodedata.normalize("NFKD", raw)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = s.lower().strip()
    for pre in _STRIP_PREFIXES:
        if s.startswith(pre):
            s = s[len(pre):]
            break
    for suf in _STRIP_SUFFIXES:
        if s.endswith(suf):
            s = s[: -len(suf)]
            break
    for suf in _STRIP_TYPE_WORDS:
        if s.endswith(suf):
            s = s[: -len(suf)]
            break
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s
