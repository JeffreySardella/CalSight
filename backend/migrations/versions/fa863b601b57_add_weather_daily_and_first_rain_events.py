"""add weather_daily and first_rain_events tables

weather_daily keeps the nClimGrid-Daily county rows the monthly loader used
to throw away; first_rain_events is the per-county, per-water-year "first
rain after the dry season vs the 28 days before it" result computed from it.

Revision ID: fa863b601b57
Revises: c4f1a9b2d3e7
Create Date: 2026-09-12 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa863b601b57'
down_revision: Union[str, None] = 'c4f1a9b2d3e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The API role reads these like any other table. Guarded because the role
# doesn't exist in CI/test databases (same pattern as mv_street_aggregates).
_GRANT = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
        GRANT SELECT ON {table} TO calsight_api_ro;
    END IF;
END
$$;
"""


def upgrade() -> None:
    op.create_table('weather_daily',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('county_code', sa.SmallInteger(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('precip_in', sa.Float(), nullable=True),
    sa.Column('avg_temp_f', sa.Float(), nullable=True),
    sa.Column('max_temp_f', sa.Float(), nullable=True),
    sa.Column('min_temp_f', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['county_code'], ['counties.code'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('county_code', 'date')
    )
    op.create_index('ix_weather_daily_date', 'weather_daily', ['date'], unique=False)
    op.execute(_GRANT.format(table='weather_daily'))

    op.create_table('first_rain_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('county_code', sa.SmallInteger(), nullable=False),
    sa.Column('water_year', sa.SmallInteger(), nullable=False),
    sa.Column('first_rain_date', sa.Date(), nullable=False),
    sa.Column('precip_in', sa.Float(), nullable=False),
    sa.Column('dry_days_before', sa.Integer(), nullable=False),
    sa.Column('crashes_on_day', sa.Integer(), nullable=False),
    sa.Column('baseline_daily_crashes', sa.Float(), nullable=False),
    sa.Column('baseline_days', sa.Integer(), nullable=False),
    sa.Column('lift_pct', sa.Float(), nullable=True),
    sa.Column('computed_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['county_code'], ['counties.code'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('county_code', 'water_year')
    )
    op.execute(_GRANT.format(table='first_rain_events'))


def downgrade() -> None:
    op.drop_table('first_rain_events')
    op.drop_index('ix_weather_daily_date', table_name='weather_daily')
    op.drop_table('weather_daily')
