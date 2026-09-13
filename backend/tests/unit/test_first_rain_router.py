"""/api/first-rain/series county parsing: exactly one slug or a 422 FilterError
(not the ValueError/TypeError that used to surface as a 500)."""

import pytest

from app.filters import FilterError
from app.routers.first_rain import one_county_code

SLUGS = {"los-angeles": 19, "orange": 30}


def test_one_slug_resolves():
    assert one_county_code("los-angeles", SLUGS) == 19


@pytest.mark.parametrize("raw", ["los-angeles,orange", "", None])
def test_zero_or_many_slugs_is_a_422(raw):
    with pytest.raises(FilterError) as exc:
        one_county_code(raw, SLUGS)
    assert exc.value.filter == "county"
    assert "exactly one county" in exc.value.detail


def test_unknown_slug_still_reports_unknown():
    with pytest.raises(FilterError, match="Unknown county"):
        one_county_code("atlantis", SLUGS)
