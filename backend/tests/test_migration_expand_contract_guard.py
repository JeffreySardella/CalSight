"""Unit tests for the expand/contract migration guard's detection logic."""

from scripts.check_migration_expand_contract import (
    contracting_ops_in_upgrade,
    has_safety_marker,
)

_EXPAND_ONLY = '''
def upgrade():
    op.add_column("crashes", sa.Column("new_flag", sa.Boolean))
    op.create_index("ix_new_flag", "crashes", ["new_flag"])

def downgrade():
    op.drop_index("ix_new_flag")
    op.drop_column("crashes", "new_flag")
'''

_DROP_IN_UPGRADE = '''
def upgrade():
    op.drop_column("crashes", "legacy_col")

def downgrade():
    op.add_column("crashes", sa.Column("legacy_col", sa.String))
'''

_RAW_SQL_DROP = '''
def upgrade():
    op.execute("ALTER TABLE crashes DROP COLUMN legacy_col")
'''

_RENAME = '''
def upgrade():
    op.rename_column("crashes", "old", "new")
'''


def test_expand_only_upgrade_has_no_violations():
    assert contracting_ops_in_upgrade(_EXPAND_ONLY) == []


def test_drops_in_downgrade_are_ignored():
    # _EXPAND_ONLY drops in downgrade() — must not be flagged.
    ops = contracting_ops_in_upgrade(_EXPAND_ONLY)
    assert not any("drop" in o for o in ops)


def test_drop_column_in_upgrade_is_flagged():
    ops = contracting_ops_in_upgrade(_DROP_IN_UPGRADE)
    assert len(ops) == 1
    assert "drop_column" in ops[0]


def test_raw_sql_drop_is_flagged():
    ops = contracting_ops_in_upgrade(_RAW_SQL_DROP)
    assert len(ops) == 1
    assert "raw SQL" in ops[0]


def test_rename_in_upgrade_is_flagged():
    ops = contracting_ops_in_upgrade(_RENAME)
    assert "rename_column" in ops[0]


def test_safety_marker_detected():
    assert has_safety_marker("# migration-safety: intentional, no reader\n")
    assert not has_safety_marker("# just a normal comment\n")


def test_real_migrations_upgrade_paths_are_expand_only_or_marked():
    """Every committed migration's upgrade() must be expand-only OR carry the
    acknowledgment marker — the same rule CI enforces on new ones, applied to
    the whole tree as a backstop."""
    from pathlib import Path

    versions = Path(__file__).resolve().parent.parent / "migrations" / "versions"
    offenders = []
    for path in versions.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        if has_safety_marker(source):
            continue
        if contracting_ops_in_upgrade(source):
            offenders.append(path.name)

    assert not offenders, (
        "migrations with an unacknowledged contracting upgrade(): "
        f"{offenders}. Add a `# migration-safety:` comment if intentional."
    )
