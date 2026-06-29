"""add fars_county_year table

NHTSA FARS fatal-crash aggregates per county/year. New empty table —
plain CREATE TABLE (no CONCURRENTLY needed).

Revision ID: t8u9v0w1x2y3
Revises: s7t8u9v0w1x2
Create Date: 2026-06-29 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "t8u9v0w1x2y3"
down_revision: Union[str, None] = "s7t8u9v0w1x2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fars_county_year",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("fatalities", sa.Integer(), nullable=True),
        sa.Column("unrestrained_killed", sa.Integer(), nullable=True),
        sa.Column("restraint_known_killed", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )
    op.create_index("ix_fars_county_year", "fars_county_year", ["county_code", "year"])


def downgrade() -> None:
    op.drop_index("ix_fars_county_year", table_name="fars_county_year")
    op.drop_table("fars_county_year")
