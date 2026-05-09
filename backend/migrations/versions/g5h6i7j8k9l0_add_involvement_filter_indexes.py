"""add partial indexes for involvement filter columns

Speeds up raw-table queries when involvement/age filters are active
on /api/stats (which falls back to the crashes table instead of MVs).

Revision ID: g5h6i7j8k9l0
Revises: f8a1b2c3d4e5
Create Date: 2026-05-09 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "g5h6i7j8k9l0"
down_revision: Union[str, None] = "f8a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_crashes_alcohol ON crashes (is_alcohol_involved) WHERE is_alcohol_involved IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crashes_distraction ON crashes (is_distraction_involved) WHERE is_distraction_involved IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crashes_pedestrian ON crashes (pedestrian_involved) WHERE pedestrian_involved = true")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crashes_cyclist ON crashes (cyclist_involved) WHERE cyclist_involved IS NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_crashes_drug ON crashes (is_drug_involved) WHERE is_drug_involved IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_crashes_alcohol")
    op.execute("DROP INDEX IF EXISTS ix_crashes_distraction")
    op.execute("DROP INDEX IF EXISTS ix_crashes_pedestrian")
    op.execute("DROP INDEX IF EXISTS ix_crashes_cyclist")
    op.execute("DROP INDEX IF EXISTS ix_crashes_drug")
