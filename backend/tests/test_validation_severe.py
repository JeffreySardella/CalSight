"""KSI guard: a complete year whose seriously-injured total is 0 means a backfill didn't run."""

from etl.validation import check_severe_injured_coverage


class _Result:
    def __init__(self, years):
        self._years = years

    def scalars(self):
        return self

    def all(self):
        return self._years


class _DB:
    def __init__(self, years):
        self.years = years
        self.sql = None

    def execute(self, clause, params=None):
        self.sql = " ".join(str(clause).split()).lower()
        return _Result(self.years)


def test_flags_years_with_zero_seriously_injured():
    db = _DB([2001, 2002])
    check = check_severe_injured_coverage(db)
    assert check.passed is False
    assert check.severity == "warning"
    assert "2001" in check.message and "2002" in check.message
    assert "from mv_crashes_by_year" in db.sql
    assert "having sum(total_severe_injured) = 0" in db.sql


def test_passes_when_every_complete_year_has_some():
    check = check_severe_injured_coverage(_DB([]))
    assert check.passed is True
