"""denormalize county_name and pre-extract crash_year onto crashes

Two performance columns on the 11M-row crashes table, both backfilled by
etl.backfill_derived:

  - county_name (String(50)) — a copy of counties.name so dashboard
    tooltip and export queries don't need to JOIN counties every time.
    County names don't change in California (no renames in decades), so
    denormalization risk is effectively zero. If a name ever did change,
    a one-line UPDATE FROM counties re-syncs everything.

  - crash_year (SmallInteger, indexed) — same pattern as crash_hour.
    Year appears in ~80% of dashboard filters. An indexed integer column
    is faster than EXTRACT(year FROM crash_datetime) on 11M rows.

Both are low-risk additions: reversible, no data loss on downgrade.

Revision ID: f2c3d4e5f6a7
Revises: f1b2c3d4e5f6
Create Date: 2026-04-17 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2c3d4e5f6a7'
down_revision: Union[str, None] = 'f1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "crashes",
        sa.Column("county_name", sa.String(50), nullable=True),
    )
    op.add_column(
        "crashes",
        sa.Column("crash_year", sa.SmallInteger(), nullable=True),
    )
    # crash_year is heavily filtered on — index it.
    # county_name is mostly used in SELECT/tooltip, not WHERE, so no index.
    op.create_index(
        "ix_crashes_crash_year",
        "crashes",
        ["crash_year"],
    )
    # Composite that covers "crashes in county X in year Y" — very common
    # filter combo. Supercedes ix_crashes_county_datetime for year-bucketed
    # queries (the datetime one still helps range queries).
    op.create_index(
        "ix_crashes_county_crash_year",
        "crashes",
        ["county_code", "crash_year"],
    )


def downgrade() -> None:
    op.drop_index("ix_crashes_county_crash_year")
    op.drop_index("ix_crashes_crash_year")
    op.drop_column("crashes", "crash_year")
    op.drop_column("crashes", "county_name")
