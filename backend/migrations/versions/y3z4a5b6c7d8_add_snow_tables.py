"""add snow_stations + snow_daily tables (water module snowpack)

Daily snow water equivalent per CDEC snow-pillow station. New empty
tables — plain CREATE TABLE. Mirrors the reservoir tables: the unique
constraint backs (station_id, date) lookups, plus an expression index
on (station_id, extract(month), extract(day)) INCLUDE (swe_in) for the
day-of-year percent-of-average query. Grants SELECT to the read-only
API role where it exists.

Revision ID: y3z4a5b6c7d8
Revises: x2y3z4a5b6c7
Create Date: 2026-07-11 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "y3z4a5b6c7d8"
down_revision: Union[str, None] = "x2y3z4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "snow_stations",
        sa.Column("station_id", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("elevation_ft", sa.Integer(), nullable=True),
        sa.Column("region", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("station_id"),
    )
    op.create_index("ix_snow_stations_region", "snow_stations", ["region"])
    op.create_table(
        "snow_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("station_id", sa.String(length=10), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("swe_in", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["station_id"], ["snow_stations.station_id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("station_id", "date", name="uq_snow_daily_station_date"),
    )
    op.execute(
        """
        CREATE INDEX ix_snow_daily_station_doy ON snow_daily
            (station_id, EXTRACT(month FROM date), EXTRACT(day FROM date))
            INCLUDE (swe_in)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON snow_stations, snow_daily TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_snow_daily_station_doy", table_name="snow_daily")
    op.drop_table("snow_daily")
    op.drop_index("ix_snow_stations_region", table_name="snow_stations")
    op.drop_table("snow_stations")
