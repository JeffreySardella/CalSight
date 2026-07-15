"""add reservoirs + reservoir_daily tables (water module v1)

New empty tables — plain CREATE TABLE (no CONCURRENTLY needed).
Grants SELECT to the production read-only API role so the /api/water
endpoints can serve them; no-op where the role doesn't exist (local
dev, CI databases) — same pattern as the chat_feedback grant.

Revision ID: z4a5b6c7d8e9
Revises: y3z4a5b6c7d8
Create Date: 2026-07-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "z4a5b6c7d8e9"
down_revision: Union[str, None] = "y3z4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reservoirs",
        sa.Column("station_id", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("capacity_af", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("station_id"),
    )
    op.create_table(
        "reservoir_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("station_id", sa.String(length=10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("storage_af", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["station_id"], ["reservoirs.station_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "station_id", "date", name="uq_reservoir_daily_station_date"
        ),
    )
    # (station_id, date) lookups are served by the unique constraint's
    # backing index. This expression index serves the day-of-year
    # historical-average query (filter on extract(month)/extract(day)),
    # with storage_af included for index-only scans.
    op.execute(
        """
        CREATE INDEX ix_reservoir_daily_station_doy ON reservoir_daily
            (station_id, EXTRACT(month FROM date), EXTRACT(day FROM date))
            INCLUDE (storage_af)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON reservoirs, reservoir_daily TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_reservoir_daily_station_doy", table_name="reservoir_daily")
    op.drop_table("reservoir_daily")
    op.drop_table("reservoirs")
