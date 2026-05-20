"""add lat/lng partial index for heatmap queries

The statewide heatmap scans all 11M rows for non-null coordinates.
A partial index on (latitude, longitude) WHERE both are NOT NULL
limits the index to the ~37% of rows that have coordinates.
Uses CONCURRENTLY to avoid locking the table.

Revision ID: n2o3p4q5r6s7
Revises: m1n2o3p4q5r6
Create Date: 2026-05-19 00:01:00.000000
"""
from typing import Sequence, Union

from alembic import op

# Required for CREATE INDEX CONCURRENTLY
revision_is_non_transactional = True

revision: str = "n2o3p4q5r6s7"
down_revision: Union[str, None] = "m1n2o3p4q5r6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_crashes_lat_lng "
        "ON crashes (latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_crashes_lat_lng", table_name="crashes")
