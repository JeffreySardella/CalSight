"""The alembic revision graph must stay a single, valid chain.

A duplicate revision id doesn't fail at import — alembic only notices when it
builds the graph, and it reports the symptom ("Cycle is detected in revisions
...") rather than the cause, listing four ids of which none is obviously the
culprit. This has cost the project two debugging rounds now (the water branch
and mv_street_aggregates), so it gets a fast test that names the offender.

Pure filesystem parsing — no database, so it runs in the unit suite.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parent.parent / "migrations" / "versions"

_REVISION = re.compile(r"^revision(?::\s*str)?\s*=\s*[\"']([^\"']+)[\"']", re.M)
_DOWN_REVISION = re.compile(
    r"^down_revision(?::\s*[^=]+)?\s*=\s*[\"']([^\"']+)[\"']", re.M
)


def _migrations() -> list[tuple[str, str | None, str]]:
    """(revision, down_revision, filename) for every migration on disk."""
    out = []
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name == "__init__.py":
            continue
        source = path.read_text(encoding="utf-8")
        rev = _REVISION.search(source)
        assert rev, f"{path.name} has no parseable `revision` line"
        down = _DOWN_REVISION.search(source)
        out.append((rev.group(1), down.group(1) if down else None, path.name))
    return out


def test_revision_ids_are_unique():
    by_id: dict[str, list[str]] = defaultdict(list)
    for rev, _down, name in _migrations():
        by_id[rev].append(name)

    duplicates = {rev: files for rev, files in by_id.items() if len(files) > 1}
    assert not duplicates, (
        "Duplicate alembic revision ids — alembic will report this as a "
        f"confusing 'cycle detected': {duplicates}"
    )


def test_every_down_revision_exists():
    migrations = _migrations()
    known = {rev for rev, _down, _name in migrations}
    dangling = [
        (name, down)
        for _rev, down, name in migrations
        if down is not None and down not in known
    ]
    assert not dangling, f"down_revision points at a missing revision: {dangling}"


def test_graph_has_exactly_one_head_and_one_base():
    migrations = _migrations()
    parents = {down for _rev, down, _name in migrations if down is not None}

    heads = [(rev, name) for rev, _down, name in migrations if rev not in parents]
    bases = [(rev, name) for rev, down, name in migrations if down is None]

    assert len(heads) == 1, (
        f"expected a single migration head, found {len(heads)}: {heads}. "
        "Two heads mean two branches were created in parallel and need merging."
    )
    assert len(bases) == 1, f"expected a single base migration, found {bases}"


def test_graph_is_acyclic_and_reaches_every_migration():
    """Walk head -> base; every migration must appear exactly once."""
    migrations = _migrations()
    down_of = {rev: down for rev, down, _name in migrations}
    name_of = {rev: name for rev, _down, name in migrations}
    parents = {down for down in down_of.values() if down is not None}

    head = next(rev for rev in down_of if rev not in parents)

    seen: list[str] = []
    cursor: str | None = head
    while cursor is not None:
        assert cursor not in seen, f"cycle through {name_of.get(cursor, cursor)}"
        seen.append(cursor)
        cursor = down_of[cursor]

    orphans = sorted(set(down_of) - set(seen))
    assert not orphans, (
        "migrations unreachable from head: "
        f"{[name_of[rev] for rev in orphans]}"
    )
