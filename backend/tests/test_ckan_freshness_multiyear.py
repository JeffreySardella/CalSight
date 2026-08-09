"""CKAN freshness must cover the same years the loader re-loads.

The incremental crash loader always re-loads the latest two years, but the
freshness probe only looked at the single newest year's resource. So a
revision published to the prior year (which the loader WOULD pick up) was
reported "unchanged", and the whole run was skipped.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import etl._utils as U


def _job():
    return SimpleNamespace(
        name="crashes_ccrs",
        freshness_ckan_prefix="Crashes",
        freshness_resource_id="pinned-fallback-id",
    )


def _resp(last_modified: str):
    return SimpleNamespace(json=lambda: {"result": {"last_modified": last_modified}})


# Two discovered years: 2024 -> res-2024, 2025 -> res-2025 (the newest).
_DISCOVERED = {2024: "res-2024", 2025: "res-2025"}


def _run(last_run_iso: str, modified_by_resource: dict[str, str]):
    last_run = SimpleNamespace(finished_at=datetime.fromisoformat(last_run_iso))

    def fake_get(url, params=None, timeout=None):
        return _resp(modified_by_resource[params["id"]])

    with (
        patch.object(U, "discover_resource_ids", return_value=dict(_DISCOVERED)),
        patch.object(U, "get_with_retry", side_effect=fake_get),
    ):
        return U._check_ckan_freshness(_job(), last_run)


def test_probes_the_newest_two_years():
    resolved = None
    with patch.object(U, "discover_resource_ids", return_value=dict(_DISCOVERED)):
        resolved = U._resolve_ckan_freshness_resources(_job())
    assert set(resolved) == {"res-2024", "res-2025"}


def test_prior_year_revision_marks_fresh():
    # Newest year (2025) unchanged, but the PRIOR year (2024) was revised
    # after the last run — the loader would re-load it, so freshness must run.
    result = _run(
        "2026-08-01T00:00:00",
        {"res-2025": "2026-07-01T00:00:00", "res-2024": "2026-08-05T00:00:00"},
    )
    assert result.is_fresh is True


def test_both_years_unchanged_is_not_fresh():
    result = _run(
        "2026-08-10T00:00:00",
        {"res-2025": "2026-07-01T00:00:00", "res-2024": "2026-06-01T00:00:00"},
    )
    assert result.is_fresh is False


def test_newest_year_change_still_detected():
    result = _run(
        "2026-08-01T00:00:00",
        {"res-2025": "2026-08-05T00:00:00", "res-2024": "2026-06-01T00:00:00"},
    )
    assert result.is_fresh is True


def test_falls_back_to_pinned_resource_without_discovery():
    job = SimpleNamespace(
        name="x", freshness_ckan_prefix=None, freshness_resource_id="pinned-fallback-id",
    )
    with patch.object(U, "discover_resource_ids", return_value={}):
        assert U._resolve_ckan_freshness_resources(job) == ["pinned-fallback-id"]
