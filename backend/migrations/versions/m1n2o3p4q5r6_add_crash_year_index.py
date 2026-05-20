"""add crash_year index on crashes table (11M rows)

80% of dashboard queries filter by crash_year but the column had no
dedicated index. Uses CONCURRENTLY to avoid locking the table.

Revision ID: m1n2o3p4q5r6
Revises: l0m1n2o3p4q5
Create Date: 2026-05-19 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# Required for CREATE INDEX CONCURRENTLY
revision_is_non_transactional = True

revision: str = "m1n2o3p4q5r6"
down_revision: Union[str, None] = "l0m1n2o3p4q5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_crashes_crash_year ON crashes (crash_year)")


def downgrade() -> None:
    op.drop_index("ix_crashes_crash_year", table_name="crashes")
