"""add 7 more demographic fields

Adds per_capita_income, mean_travel_time_to_work, pct_foreign_born,
pct_rent_burdened, pct_enrolled_in_school, pct_veteran, pct_with_disability
to the demographics table. All nullable; existing rows stay NULL until the
ETL re-runs.

Sources:
  B19301 — per capita income (direct value)
  B08013 / B08301 — aggregate travel time / workers 16+
  B05002 — place of birth (foreign-born share)
  B25070 — gross rent as % of household income
  B14001 — school enrollment
  B21001 — veteran status
  B18101 — sex by age by disability status

Revision ID: c6f3a2e7b9d1
Revises: b5e9d3f1c8a4
Create Date: 2026-04-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c6f3a2e7b9d1'
down_revision: Union[str, None] = 'b5e9d3f1c8a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_NEW_COLUMNS = [
    ('per_capita_income', sa.Integer()),
    ('mean_travel_time_to_work', sa.Float()),
    ('pct_foreign_born', sa.Float()),
    ('pct_rent_burdened', sa.Float()),
    ('pct_enrolled_in_school', sa.Float()),
    ('pct_veteran', sa.Float()),
    ('pct_with_disability', sa.Float()),
]


def upgrade() -> None:
    for name, type_ in _NEW_COLUMNS:
        op.add_column('demographics', sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_NEW_COLUMNS):
        op.drop_column('demographics', name)
