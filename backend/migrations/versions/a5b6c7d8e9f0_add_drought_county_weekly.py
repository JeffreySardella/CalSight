"""add drought_county_weekly table (water module phase 2)

Weekly US Drought Monitor severity percentages per county. New empty
table — plain CREATE TABLE. Grants SELECT to the production read-only
API role (no-op where the role doesn't exist), same pattern as the
reservoir tables.

Revision ID: a5b6c7d8e9f0
Revises: z4a5b6c7d8e9
Create Date: 2026-07-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a5b6c7d8e9f0"
down_revision: Union[str, None] = "z4a5b6c7d8e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "drought_county_weekly",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("none_pct", sa.Float(), nullable=False),
        sa.Column("d0_pct", sa.Float(), nullable=False),
        sa.Column("d1_pct", sa.Float(), nullable=False),
        sa.Column("d2_pct", sa.Float(), nullable=False),
        sa.Column("d3_pct", sa.Float(), nullable=False),
        sa.Column("d4_pct", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "week_start", name="uq_drought_county_week"),
    )
    # (county_code, week_start) is served by the unique constraint's index.
    op.create_index("ix_drought_week_start", "drought_county_weekly", ["week_start"])
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON drought_county_weekly TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_drought_week_start", table_name="drought_county_weekly")
    op.drop_table("drought_county_weekly")
