#!/usr/bin/env python3
"""Guard new Alembic migrations against unacknowledged contracting changes.

The deploy pipeline never runs `alembic downgrade` and, on a failed deploy,
rolls the *code* back to the previous image while leaving the schema migrated
(deploy.yml). That only stays safe if every migration is backward-compatible:
the previous code must keep working against the new schema. A contracting
change in `upgrade()` — dropping or renaming a column/table the old code still
reads — breaks that assumption and turns a rollback into an outage.

This checks migration files (typically the ones ADDED in a PR) for contracting
operations in their `upgrade()` function. A migration that genuinely needs one
must acknowledge it with a marker comment so the reviewer sees the intent:

    # migration-safety: drops the legacy column in a later release; no live
    #   code reads it as of this deploy.

Only `upgrade()` is inspected — drops in `downgrade()` are expected and fine.

Usage:
    python -m scripts.check_migration_expand_contract <file> [<file> ...]

Exits non-zero if any file has an unacknowledged contracting change.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

# Alembic op.* calls that remove or rename schema the old code may still read.
# Dropping a CONSTRAINT is deliberately excluded: relaxing a unique/check/FK
# constraint is backward-compatible for readers (the previous image keeps
# working), and constraints are routinely dropped to be redefined. The danger
# is losing a column/table the old code still selects.
_CONTRACTING_OPS = frozenset({
    "drop_column",
    "drop_table",
    "rename_column",
    "rename_table",
})

# Raw-SQL contracting statements inside op.execute("...").
_RAW_SQL_CONTRACTING = re.compile(
    r"\b(drop\s+table|drop\s+column|alter\s+table\s+.+\bdrop\b|rename\s+to)\b",
    re.IGNORECASE | re.DOTALL,
)

_SAFETY_MARKER = re.compile(r"#\s*migration-safety:", re.IGNORECASE)


def has_safety_marker(source: str) -> bool:
    """True when the author acknowledged a contracting change."""
    return bool(_SAFETY_MARKER.search(source))


def _upgrade_function(tree: ast.AST) -> ast.FunctionDef | None:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "upgrade":
            return node
    return None


def contracting_ops_in_upgrade(source: str) -> list[str]:
    """Contracting operations found in the migration's upgrade(), as
    "op_name (line N)" strings. Empty when upgrade() is expand-only.

    downgrade() is intentionally ignored — undoing a migration is expected to
    drop things.
    """
    tree = ast.parse(source)
    upgrade = _upgrade_function(tree)
    if upgrade is None:
        return []

    found: list[str] = []
    for node in ast.walk(upgrade):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in _CONTRACTING_OPS:
                found.append(f"{node.func.attr} (line {node.func.lineno})")
            elif node.func.attr == "execute":
                for arg in node.args:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        if _RAW_SQL_CONTRACTING.search(arg.value):
                            found.append(f"raw SQL drop/rename (line {node.lineno})")
    return found


def check_file(path: Path) -> list[str]:
    """Return a list of violation messages for one migration file."""
    source = path.read_text(encoding="utf-8")
    if has_safety_marker(source):
        return []
    return [f"{path.name}: {op}" for op in contracting_ops_in_upgrade(source)]


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv if a.endswith(".py")]
    if not files:
        print("No migration files to check.")
        return 0

    violations: list[str] = []
    for path in files:
        violations.extend(check_file(path))

    if violations:
        print("Unacknowledged contracting migration change(s) detected:\n")
        for v in violations:
            print(f"  - {v}")
        print(
            "\nThe deploy pipeline rolls code back but not the schema, so every\n"
            "migration must be backward-compatible. If this drop/rename is\n"
            "intentional and no live code reads the affected schema, add a\n"
            "marker comment to the migration:\n\n"
            "    # migration-safety: <why this is safe for the running code>\n"
        )
        return 1

    print(f"Checked {len(files)} migration file(s): all expand-only or acknowledged.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
