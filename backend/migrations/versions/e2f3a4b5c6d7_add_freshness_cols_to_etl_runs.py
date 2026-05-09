"""add last_source_modified and source_row_count to etl_runs

Revision ID: e2f3a4b5c6d7
Revises: d1a2b3c4d5e6
Create Date: 2026-05-08 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, None] = 'd1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("etl_runs", sa.Column("last_source_modified", sa.DateTime(), nullable=True))
    op.add_column("etl_runs", sa.Column("source_row_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("etl_runs", "source_row_count")
    op.drop_column("etl_runs", "last_source_modified")
