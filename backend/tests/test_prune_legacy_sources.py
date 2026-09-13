from etl.orchestrator import Job, JobRegistry
from etl.prune_legacy_sources import legacy_sources


def _registry(*names):
    registry = JobRegistry()
    for name in names:
        registry.register(Job(name=name, module=f"etl.{name}"))
    return registry


def test_only_unregistered_sources_are_selected():
    registry = _registry("crashes_ccrs", "parties", "victims", "matviews", "insights")
    sources = [
        "crashes_ccrs", "parties", "victims", "matviews", "insights",
        "parties_victims", "materialized_views", "generate_insights", "ccrs",
    ]
    assert legacy_sources(sources, registry) == [
        "ccrs", "generate_insights", "materialized_views", "parties_victims",
    ]


def test_nothing_selected_when_every_source_is_registered():
    registry = _registry("crashes_ccrs", "insights")
    assert legacy_sources(["insights", "crashes_ccrs", "insights"], registry) == []


def test_live_registry_keeps_every_current_job_name():
    """The 7 zombies from the 2026-09-12 audit go; every registered name stays."""
    from etl.jobs import build_default_registry

    registry = build_default_registry()
    zombies = [
        "backfill_derived", "ccrs", "extract_route_number", "generate_insights",
        "materialized_views", "parties_victims", "traffic_volumes",
    ]
    assert legacy_sources(list(registry.jobs) + zombies, registry) == sorted(zombies)
