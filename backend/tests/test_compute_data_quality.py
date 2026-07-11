"""Tests for the data quality stats computation."""

from etl.compute_data_quality import _safe_pct


class TestSafePct:
    def test_normal_percentage(self):
        assert _safe_pct(75, 100) == 75.0

    def test_rounds_to_one_decimal(self):
        assert _safe_pct(1, 3) == 33.3

    def test_zero_denominator_returns_none(self):
        assert _safe_pct(5, 0) is None

    def test_none_denominator_returns_none(self):
        assert _safe_pct(5, None) is None

    def test_zero_numerator(self):
        assert _safe_pct(0, 100) == 0.0

    def test_hundred_percent(self):
        assert _safe_pct(500, 500) == 100.0


# ---------------------------------------------------------------------------
# Atomic rebuild (#292): DELETE + re-INSERT must happen in ONE transaction so
# /api/data-quality never observes an empty (or half-full) table mid-rebuild.
# ---------------------------------------------------------------------------

class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    """Records the order of DELETE / add / commit operations."""

    def __init__(self, crash_rows):
        self.events: list[str] = []
        self._crash_rows = crash_rows

    def execute(self, clause):
        sql = str(clause)
        if sql.strip().upper().startswith("DELETE"):
            self.events.append("delete")
            return _FakeResult([])
        self.events.append("select")
        # Only the crashes query yields rows; party/victim queries are empty.
        if "FROM crashes" in sql and "JOIN" not in sql:
            return _FakeResult(self._crash_rows)
        return _FakeResult([])

    def add(self, obj):
        self.events.append("add")

    def commit(self):
        self.events.append("commit")


_CRASH_ROW = {
    "county_code": 19, "yr": 2023, "total": 10, "has_coords": 9,
    "has_factor": 8, "has_weather": 7, "has_road_cond": 6, "has_lighting": 5,
    "has_alcohol_flag": 4, "alcohol_true": 2, "has_distraction_flag": 3,
    "distraction_true": 1,
}


class TestAtomicRebuild:
    def test_single_commit_after_delete_and_inserts(self):
        from etl.compute_data_quality import compute_stats

        db = _FakeSession([_CRASH_ROW])
        compute_stats(db)

        # Exactly one commit, and it is the very last operation — the DELETE
        # and all inserts share one transaction (atomic swap).
        assert db.events.count("commit") == 1
        assert db.events[-1] == "commit"

        # The DELETE happens before any insert, inside the same transaction.
        assert "delete" in db.events
        assert "add" in db.events
        assert db.events.index("delete") < db.events.index("add")
