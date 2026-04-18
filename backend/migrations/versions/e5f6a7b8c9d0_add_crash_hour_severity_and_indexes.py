"""add crash_hour, severity columns and indexes for filter performance

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-04-16 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # New columns
    op.add_column('crashes', sa.Column('crash_hour', sa.SmallInteger(), nullable=True))
    op.add_column('crashes', sa.Column('severity', sa.String(25), nullable=True))

    # Indexes for the filter panel — without these, filtering 11M rows
    # by boolean or category is a full table scan
    op.create_index('ix_crashes_alcohol', 'crashes', ['is_alcohol_involved'])
    op.create_index('ix_crashes_distraction', 'crashes', ['is_distraction_involved'])
    op.create_index('ix_crashes_severity', 'crashes', ['severity'])
    op.create_index('ix_crashes_crash_hour', 'crashes', ['crash_hour'])


def downgrade() -> None:
    op.drop_index('ix_crashes_crash_hour')
    op.drop_index('ix_crashes_severity')
    op.drop_index('ix_crashes_distraction')
    op.drop_index('ix_crashes_alcohol')
    op.drop_column('crashes', 'severity')
    op.drop_column('crashes', 'crash_hour')
