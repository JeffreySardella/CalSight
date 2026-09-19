"""Unit tests for the one-off SWITRS KSI backfill (no database)."""

import sqlite3

import pytest

from etl.backfill_switrs_ksi import (
    assert_severe_column,
    read_severe_counts,
    year_failure,
)
from etl.switrs_api import _fold_case_id

BIG = 9_234_567_890_123_456_789  # > 2**63-1, like 211,120 of 2001's case ids
FOLDED = _fold_case_id(BIG)


def _archive(rows, with_column=True):
    conn = sqlite3.connect(":memory:")
    if with_column:
        conn.execute("CREATE TABLE collisions (case_id TEXT, collision_date TEXT, severe_injury_count INTEGER)")
        conn.executemany("INSERT INTO collisions VALUES (?, ?, ?)", rows)
    else:
        conn.execute("CREATE TABLE collisions (case_id TEXT, collision_date TEXT)")
    return conn


def test_reads_one_year_and_folds_oversized_ids():
    conn = _archive([
        (str(BIG), "2001-12-31", 2),
        ("100", "2001-01-01", 1),
        ("200", "2002-01-01", 5),
    ])
    assert read_severe_counts(conn, 2001) == {FOLDED: 2, 100: 1}


def test_zero_negative_and_null_counts_are_skipped():
    conn = _archive([
        ("1", "2001-02-02", 0),
        ("2", "2001-02-02", -3),
        ("3", "2001-02-02", None),
        ("4", "2001-02-02", 1),
    ])
    assert read_severe_counts(conn, 2001) == {4: 1}


def test_duplicate_case_id_last_wins_like_the_loader():
    conn = _archive([("5", "2001-03-03", 1), ("5", "2001-03-04", 2)])
    assert read_severe_counts(conn, 2001) == {5: 2}


def test_missing_column_fails_loudly():
    with pytest.raises(RuntimeError, match="severe_injury_count"):
        assert_severe_column(_archive([], with_column=False))


def test_year_failure_rules():
    assert year_failure(2001, {}, 0) == "2001: no seriously injured people in the archive"
    assert year_failure(2001, {i: 1 for i in range(100)}, 99) is None
    reason = year_failure(2001, {i: 1 for i in range(100)}, 98)
    assert reason is not None and "98.0%" in reason
