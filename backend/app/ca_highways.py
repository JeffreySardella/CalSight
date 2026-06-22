"""Canonical California highway lookup.

Two responsibilities:
  1. Resolve a bare route number (from "RT 5" / "HWY 99" style values) to its
     official designation ("I-5", "SR-99"). primary_road in CCRS/SWITRS uses
     "RT N" without a type prefix, so 5 → "I-5" and 99 → "SR-99" can only be
     decided via this table.
  2. Provide centerline mileage so /api/stats/highways can compute crashes
     per mile.

Centerline miles are pulled from Caltrans' California State Highway
Inventory (https://dot.ca.gov/programs/research-innovation-system-information/
highway-performance-monitoring-system) — these are the *segment* miles within
California, not nationwide totals. Numbers are rounded to the nearest mile.

When a number isn't in this table, the regex extractor falls back to whatever
type prefix the raw string had (so "SR-178" still becomes "SR-178" even if 178
isn't in the table — just without a mileage).

To add a route: append `(number, "<canonical_id>", miles)` and run the
unit tests in `tests/test_ca_highways.py`. Both Interstates and the State
Route with the same number can exist (e.g. I-110 and SR-110); we pick the
designation that carries the bulk of the traffic, matching the convention
on Caltrans signage for the freeway segment.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Highway:
    canonical_id: str  # e.g. "I-5", "US-101", "SR-99"
    miles: float       # centerline miles within California


# Number → Highway. Covers all 12 California Interstates, all 6 US Routes
# present in CA, and the State Routes that appear in the top traffic
# rankings (top ~50 of ~250 SR routes by crash count). Numbers not present
# here will fall through to the raw type prefix in the extractor — they
# still rank by crash_count and fatality_rate, just without crashes/mile.
CA_HIGHWAYS: dict[int, Highway] = {
    # Interstates
    5: Highway("I-5", 796),
    8: Highway("I-8", 172),
    10: Highway("I-10", 244),
    15: Highway("I-15", 287),
    40: Highway("I-40", 155),
    80: Highway("I-80", 205),
    105: Highway("I-105", 18),
    110: Highway("I-110", 32),
    205: Highway("I-205", 13),
    210: Highway("I-210", 86),
    215: Highway("I-215", 55),
    238: Highway("I-238", 2),
    280: Highway("I-280", 57),
    380: Highway("I-380", 5),
    405: Highway("I-405", 72),
    505: Highway("I-505", 33),
    580: Highway("I-580", 80),
    605: Highway("I-605", 28),
    680: Highway("I-680", 70),
    710: Highway("I-710", 26),
    780: Highway("I-780", 7),
    805: Highway("I-805", 28),
    880: Highway("I-880", 46),
    980: Highway("I-980", 2),
    # US Routes
    50: Highway("US-50", 104),
    95: Highway("US-95", 130),
    97: Highway("US-97", 54),
    101: Highway("US-101", 808),
    199: Highway("US-199", 32),
    395: Highway("US-395", 558),
    # State Routes — major ones (by crash volume and total mileage)
    1: Highway("SR-1", 656),
    2: Highway("SR-2", 81),
    3: Highway("SR-3", 145),
    4: Highway("SR-4", 195),
    9: Highway("SR-9", 38),
    11: Highway("SR-11", 3),
    12: Highway("SR-12", 218),
    13: Highway("SR-13", 6),
    14: Highway("SR-14", 118),
    16: Highway("SR-16", 162),
    17: Highway("SR-17", 26),
    18: Highway("SR-18", 138),
    19: Highway("SR-19", 16),
    20: Highway("SR-20", 213),
    22: Highway("SR-22", 18),
    23: Highway("SR-23", 31),
    24: Highway("SR-24", 14),
    25: Highway("SR-25", 75),
    26: Highway("SR-26", 78),
    27: Highway("SR-27", 14),
    29: Highway("SR-29", 109),
    33: Highway("SR-33", 290),
    35: Highway("SR-35", 56),
    37: Highway("SR-37", 21),
    39: Highway("SR-39", 27),
    41: Highway("SR-41", 178),
    43: Highway("SR-43", 96),
    44: Highway("SR-44", 109),
    46: Highway("SR-46", 130),
    49: Highway("SR-49", 295),
    52: Highway("SR-52", 18),
    54: Highway("SR-54", 13),
    55: Highway("SR-55", 17),
    56: Highway("SR-56", 9),
    57: Highway("SR-57", 25),
    58: Highway("SR-58", 144),
    59: Highway("SR-59", 50),
    60: Highway("SR-60", 70),
    62: Highway("SR-62", 151),
    65: Highway("SR-65", 90),
    66: Highway("SR-66", 30),
    67: Highway("SR-67", 27),
    68: Highway("SR-68", 22),
    70: Highway("SR-70", 213),
    71: Highway("SR-71", 14),
    74: Highway("SR-74", 87),
    75: Highway("SR-75", 11),
    76: Highway("SR-76", 53),
    78: Highway("SR-78", 215),
    79: Highway("SR-79", 105),
    82: Highway("SR-82", 51),
    84: Highway("SR-84", 53),
    85: Highway("SR-85", 24),
    86: Highway("SR-86", 105),
    88: Highway("SR-88", 142),
    89: Highway("SR-89", 207),
    91: Highway("SR-91", 67),
    92: Highway("SR-92", 19),
    94: Highway("SR-94", 64),
    99: Highway("SR-99", 425),
    111: Highway("SR-111", 142),
    113: Highway("SR-113", 39),
    115: Highway("SR-115", 16),
    116: Highway("SR-116", 33),
    118: Highway("SR-118", 41),
    120: Highway("SR-120", 153),
    121: Highway("SR-121", 36),
    125: Highway("SR-125", 24),
    126: Highway("SR-126", 49),
    127: Highway("SR-127", 91),
    128: Highway("SR-128", 142),
    132: Highway("SR-132", 67),
    134: Highway("SR-134", 13),
    138: Highway("SR-138", 105),
    139: Highway("SR-139", 122),
    140: Highway("SR-140", 100),
    142: Highway("SR-142", 9),
    145: Highway("SR-145", 35),
    146: Highway("SR-146", 7),
    150: Highway("SR-150", 49),
    152: Highway("SR-152", 122),
    154: Highway("SR-154", 32),
    156: Highway("SR-156", 32),
    160: Highway("SR-160", 53),
    162: Highway("SR-162", 156),
    166: Highway("SR-166", 124),
    168: Highway("SR-168", 84),
    170: Highway("SR-170", 7),
    178: Highway("SR-178", 178),
    180: Highway("SR-180", 87),
    183: Highway("SR-183", 9),
    185: Highway("SR-185", 6),
    187: Highway("SR-187", 4),
    190: Highway("SR-190", 219),
    198: Highway("SR-198", 132),
    202: Highway("SR-202", 6),
    203: Highway("SR-203", 11),
    204: Highway("SR-204", 7),
    206: Highway("SR-206", 4),
    207: Highway("SR-207", 4),
    223: Highway("SR-223", 30),
    225: Highway("SR-225", 9),
    227: Highway("SR-227", 12),
    229: Highway("SR-229", 18),
    232: Highway("SR-232", 4),
    237: Highway("SR-237", 12),
    241: Highway("SR-241", 24),
    242: Highway("SR-242", 8),
    243: Highway("SR-243", 30),
    245: Highway("SR-245", 47),
    246: Highway("SR-246", 47),
    247: Highway("SR-247", 78),
    253: Highway("SR-253", 17),
    254: Highway("SR-254", 32),
    255: Highway("SR-255", 11),
    266: Highway("SR-266", 17),
    267: Highway("SR-267", 16),
    269: Highway("SR-269", 31),
    273: Highway("SR-273", 21),
    275: Highway("SR-275", 3),
    282: Highway("SR-282", 1),
    299: Highway("SR-299", 306),
    330: Highway("SR-330", 16),
    371: Highway("SR-371", 22),
    905: Highway("SR-905", 7),
}


_CANONICAL_TO_MILES: dict[str, float] = {
    hw.canonical_id: hw.miles for hw in CA_HIGHWAYS.values()
}


def resolve_route(number: int) -> Highway | None:
    """Return the canonical highway for a bare route number, or None."""
    return CA_HIGHWAYS.get(number)


def miles_for(canonical_id: str) -> float | None:
    """Return centerline miles for a canonical highway designation, or None."""
    return _CANONICAL_TO_MILES.get(canonical_id)
