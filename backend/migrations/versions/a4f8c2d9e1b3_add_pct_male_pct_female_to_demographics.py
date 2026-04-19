"""add pct_male and pct_female to demographics

Adds two nullable Float columns derived from Census table B01001
(Sex by Age). The ETL already pulls all 47 male+female age cells —
we just compute the totals as percentages of population.

Existing rows stay NULL until the demographics ETL re-runs.

Revision ID: a4f8c2d9e1b3
Revises: f3d4e5f6a7b8
Create Date: 2026-04-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4f8c2d9e1b3'
down_revision: Union[str, None] = 'f3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('demographics', sa.Column('pct_male', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_female', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('demographics', 'pct_female')
    op.drop_column('demographics', 'pct_male')
