"""Unit tests for conftest.py's test-database-name guard (Minor 5).

_create_test_db() runs DROP DATABASE / CREATE DATABASE against whatever name
TEST_DATABASE_URL resolves to — this guard is the only thing standing
between a typo'd/missing env var and dropping the wrong database, so it
needs its own direct test rather than relying on every test run implicitly
exercising only the compliant path.

The guard is `require_throwaway_db_name` (see conftest); it raises ValueError
and additionally requires the name to be alphanumeric/underscore, so a name
like "drop me_test" is refused as well as one that simply lacks the suffix.
"""

import pytest

from tests.api.conftest import require_throwaway_db_name


def test_rejects_name_without_test_suffix():
    with pytest.raises(ValueError, match="_test"):
        require_throwaway_db_name("calsight")


def test_rejects_empty_string():
    # TEST_DB_NAME itself can never be None — conftest derives it with
    # urlparse(...).lstrip("/") and falls back to "calsight_test" — so the
    # empty string is the reachable form of "no database name in the URL".
    with pytest.raises(ValueError, match="_test"):
        require_throwaway_db_name("")


def test_rejects_a_name_that_is_not_plain_identifier_text():
    """The suffix alone is not enough: the name is interpolated into SQL."""
    with pytest.raises(ValueError, match="_test"):
        require_throwaway_db_name("drop me_test")


def test_accepts_test_suffixed_name():
    assert require_throwaway_db_name("calsight_lag_test") == "calsight_lag_test"
