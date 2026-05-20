"""recreate alcohol/distraction indexes as partial

Migration e5f6a7b8c9d0 created ix_crashes_alcohol and ix_crashes_distraction
as full (non-partial) indexes. Migration g5h6i7j8k9l0 tried to replace them
with partial versions (WHERE ... IS NOT NULL) using IF NOT EXISTS, but since
the names already existed the partial versions were silently skipped.

This migration drops the old non-partial indexes and recreates them as partial
to match the model declaration. The partial versions are much smaller since
~60% of rows have NULL for these boolean flags (pre-2016 SWITRS data).

Uses CONCURRENTLY to avoid locking the table.

Revision ID: o3p4q5r6s7t8
Revises: n2o3p4q5r6s7
Create Date: 2026-05-19 00:02:00.000000
"""
from typing import Sequence, Union

from alembic import op

# Required for CREATE INDEX CONCURRENTLY
revision_is_non_transactional = True

revision: str = "o3p4q5r6s7t8"
down_revision: Union[str, None] = "n2o3p4q5r6s7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old non-partial indexes
    op.execute("DROP INDEX IF EXISTS ix_crashes_alcohol")
    op.execute("DROP INDEX IF EXISTS ix_crashes_distraction")

    # Recreate as partial — only includes rows where the flag is not null
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_crashes_alcohol "
        "ON crashes (is_alcohol_involved) WHERE is_alcohol_involved IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_crashes_distraction "
        "ON crashes (is_distraction_involved) WHERE is_distraction_involved IS NOT NULL"
    )


def downgrade() -> None:
    # Restore the original non-partial indexes
    op.execute("DROP INDEX IF EXISTS ix_crashes_alcohol")
    op.execute("DROP INDEX IF EXISTS ix_crashes_distraction")
    op.execute("CREATE INDEX ix_crashes_alcohol ON crashes (is_alcohol_involved)")
    op.execute("CREATE INDEX ix_crashes_distraction ON crashes (is_distraction_involved)")
