"""add partial (collision_id, data_source) WHERE at_fault index on crash_parties

Issue #292: mv_at_fault_parties_by_demographics (f8a1b2c3d4e5) scans
crash_parties with

    JOIN crashes c ON c.collision_id = cp.collision_id
                  AND c.data_source  = cp.data_source
    WHERE cp.at_fault = TRUE

The existing full ix_crash_parties_collision_ds covers the join key but not
the predicate; ix_crash_parties_at_fault covers the predicate but not the
join. This partial index matches the refresh query exactly — join columns in
the key, at_fault = TRUE as the predicate — and is a fraction of the size of
the full composite because only at-fault rows are indexed.

Revision ID: y3z4a5b6c7d8
Revises: x2y3z4a5b6c7
Create Date: 2026-07-10 00:00:02.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "y3z4a5b6c7d8"
down_revision: Union[str, None] = "x2y3z4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_crash_parties_at_fault_collision_ds "
        "ON crash_parties (collision_id, data_source) "
        "WHERE at_fault = TRUE"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_crash_parties_at_fault_collision_ds")
