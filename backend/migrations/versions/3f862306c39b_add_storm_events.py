"""add storm_events table

NOAA Storm Events rows for California Dense Fog and winter weather, mapped
from NWS forecast zones onto counties by etl/load_storm_events.py.

A forecast zone can straddle a county line, so one NOAA EVENT_ID legitimately
becomes several rows here — one per county the zone touches. The unique key is
therefore (source_event_id, county_code), NOT source_event_id alone; a plain
unique on the event id would make multi-county zones unloadable.

Revision ID: 3f862306c39b
Revises: bdc07f3141d1
Create Date: 2026-09-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f862306c39b'
down_revision: Union[str, None] = 'bdc07f3141d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The API role reads this like any other table. Guarded because the role
# doesn't exist in CI/test databases (same pattern as first_rain_events).
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
    op.create_table(
        'storm_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('source_event_id', sa.Integer(), nullable=False),
        sa.Column('county_code', sa.SmallInteger(), nullable=False),
        sa.Column('event_type', sa.String(length=40), nullable=False),
        sa.Column('begin_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('zone_id', sa.SmallInteger(), nullable=False),
        sa.Column('zone_name', sa.String(length=80), nullable=False),
        sa.Column('deaths_direct', sa.Integer(), server_default='0', nullable=False),
        sa.Column('injuries_direct', sa.Integer(), server_default='0', nullable=False),
        sa.Column('source', sa.String(length=60), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['county_code'], ['counties.code'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('source_event_id', 'county_code', name='uq_storm_events_event_county'),
    )
    op.create_index(
        'ix_storm_events_county_type_begin',
        'storm_events',
        ['county_code', 'event_type', 'begin_date'],
        unique=False,
    )
    op.execute(_GRANT.format(table='storm_events'))


def downgrade() -> None:
    op.drop_index('ix_storm_events_county_type_begin', table_name='storm_events')
    op.drop_table('storm_events')
