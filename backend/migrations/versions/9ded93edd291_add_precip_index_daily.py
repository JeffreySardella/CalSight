"""add precip_index_daily table (water module — Sierra precipitation indices)

Daily accumulated water-year precipitation for DWR's three regional indices
(8SI/5SI/6SI). New empty table — plain CREATE TABLE. Mirrors snow_daily: the
unique constraint backs (station_id, date) lookups, plus an expression index
on (station_id, extract(month), extract(day)) INCLUDE (accum_in) for the
day-of-year percent-of-average query. Grants SELECT to the read-only API role
where it exists. No station-metadata table — the three indices are static in
etl/cdec_api.PRECIP_INDEX_STATIONS.

Revision ID: 9ded93edd291
Revises: e09358c7c0d1
Create Date: 2026-07-17 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "9ded93edd291"
down_revision: Union[str, None] = "e09358c7c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "precip_index_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("station_id", sa.String(length=10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("accum_in", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "station_id", "date", name="uq_precip_index_daily_station_date"
        ),
    )
    op.execute(
        """
        CREATE INDEX ix_precip_index_daily_station_doy ON precip_index_daily
            (station_id, EXTRACT(month FROM date), EXTRACT(day FROM date))
            INCLUDE (accum_in)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON precip_index_daily TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_precip_index_daily_station_doy", table_name="precip_index_daily"
    )
    op.drop_table("precip_index_daily")
