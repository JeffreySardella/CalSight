"""add licensed_drivers and road_miles tables

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-15 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'licensed_drivers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('county_code', sa.SmallInteger(), sa.ForeignKey('counties.code'), nullable=False),
        sa.Column('year', sa.SmallInteger(), nullable=False),
        sa.Column('driver_count', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('county_code', 'year'),
    )
    op.create_index('ix_licensed_drivers_county_year', 'licensed_drivers', ['county_code', 'year'])

    op.create_table(
        'road_miles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('county_code', sa.SmallInteger(), sa.ForeignKey('counties.code'), nullable=False),
        sa.Column('f_system', sa.SmallInteger(), nullable=False),
        sa.Column('segment_count', sa.Integer(), nullable=True),
        sa.Column('total_miles', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('county_code', 'f_system'),
    )
    op.create_index('ix_road_miles_county', 'road_miles', ['county_code'])


def downgrade() -> None:
    op.drop_table('road_miles')
    op.drop_table('licensed_drivers')
