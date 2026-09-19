"""Unit tests for conftest.py's _require_test_suffix() guard (Minor 5).

_create_test_db() runs DROP DATABASE / CREATE DATABASE against whatever name
TEST_DATABASE_URL resolves to — this guard is the only thing standing
between a typo'd/missing env var and dropping the wrong database, so it
needs its own direct test rather than relying on every test run implicitly
exercising only the compliant path.
"""

import pytest

from tests.api.conftest import _require_test_suffix


def test_rejects_name_without_test_suffix():
    with pytest.raises(RuntimeError, match="must end with '_test'"):
        _require_test_suffix("calsight")


def test_rejects_none():
    with pytest.raises(RuntimeError, match="must end with '_test'"):
        _require_test_suffix(None)


def test_rejects_empty_string():
    with pytest.raises(RuntimeError, match="must end with '_test'"):
        _require_test_suffix("")


def test_accepts_test_suffixed_name():
    assert _require_test_suffix("calsight_lag_test") == "calsight_lag_test"
