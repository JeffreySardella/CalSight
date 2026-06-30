"""add tract_density_county_year table

Population-weighted density per county/year. New empty table — plain
CREATE TABLE.

Revision ID: u9v0w1x2y3z4
Revises: t8u9v0w1x2y3
Create Date: 2026-06-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "u9v0w1x2y3z4"
down_revision: Union[str, None] = "t8u9v0w1x2y3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tract_density_county_year",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("weighted_density", sa.Float(), nullable=True),
        sa.Column("tract_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )
    op.create_index("ix_tract_density_county_year", "tract_density_county_year", ["county_code", "year"])


def downgrade() -> None:
    op.drop_index("ix_tract_density_county_year", table_name="tract_density_county_year")
    op.drop_table("tract_density_county_year")
