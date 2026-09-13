"""Delete etl_runs rows for sources that are no longer registered jobs.

Jobs were renamed over time (parties_victims -> parties/victims,
materialized_views -> matviews, ...) and their old rows linger as "zombie"
sources in /api/freshness. Rows for any name in the job registry are never
touched.

Usage:
    python -m etl.prune_legacy_sources          # dry run: list what would go
    python -m etl.prune_legacy_sources --apply  # delete them
"""

from __future__ import annotations

import logging
import sys
from collections.abc import Iterable

from sqlalchemy import bindparam, text

from app.database import etl_engine  # write role
from etl.jobs import build_default_registry
from etl.orchestrator import JobRegistry

logger = logging.getLogger(__name__)

_DELETE = text("DELETE FROM etl_runs WHERE source IN :sources").bindparams(
    bindparam("sources", expanding=True)
)


def legacy_sources(sources: Iterable[str], registry: JobRegistry) -> list[str]:
    """Sources present in etl_runs that no registered job writes."""
    return sorted(set(sources) - set(registry.jobs))


def main(apply: bool = False) -> int:
    registry = build_default_registry()
    with etl_engine.begin() as conn:
        rows = conn.execute(
            text("SELECT source, COUNT(*) FROM etl_runs GROUP BY source ORDER BY source")
        ).all()
        counts = dict(rows)
        legacy = legacy_sources(counts, registry)
        if not legacy:
            print("No legacy sources in etl_runs.")
            return 0
        for src in legacy:
            print(f"{src}: {counts[src]} row(s)")
        if not apply:
            print("Dry run — pass --apply to delete these rows.")
            return 0
        deleted = conn.execute(_DELETE, {"sources": legacy}).rowcount
    print(f"Deleted {deleted} etl_runs row(s) across {len(legacy)} legacy source(s).")
    return deleted


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main(apply="--apply" in sys.argv)
