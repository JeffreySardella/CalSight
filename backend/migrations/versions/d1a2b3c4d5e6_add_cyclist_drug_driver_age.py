"""add cyclist_involved, is_drug_involved, at_fault_driver_age to crashes

Revision ID: d1a2b3c4d5e6
Revises: c4e8f1a2b3d5
Create Date: 2026-05-08 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1a2b3c4d5e6'
down_revision: Union[str, None] = 'c4e8f1a2b3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('crashes', sa.Column('cyclist_involved', sa.Boolean(), nullable=True))
    op.add_column('crashes', sa.Column('is_drug_involved', sa.Boolean(), nullable=True))
    op.add_column('crashes', sa.Column('at_fault_driver_age', sa.SmallInteger(), nullable=True))
    op.create_index('ix_crashes_at_fault_driver_age', 'crashes', ['at_fault_driver_age'])


def downgrade() -> None:
    op.drop_index('ix_crashes_at_fault_driver_age', table_name='crashes')
    op.drop_column('crashes', 'at_fault_driver_age')
    op.drop_column('crashes', 'is_drug_involved')
    op.drop_column('crashes', 'cyclist_involved')
