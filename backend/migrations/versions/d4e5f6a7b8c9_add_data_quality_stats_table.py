"""add data_quality_stats table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-15 21:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'data_quality_stats',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('county_code', sa.SmallInteger(), sa.ForeignKey('counties.code'), nullable=True),
        sa.Column('year', sa.SmallInteger(), nullable=True),
        # Crash-level
        sa.Column('total_crashes', sa.Integer(), nullable=True),
        sa.Column('crashes_with_coords', sa.Integer(), nullable=True),
        sa.Column('coords_pct', sa.Float(), nullable=True),
        sa.Column('crashes_with_primary_factor', sa.Integer(), nullable=True),
        sa.Column('primary_factor_pct', sa.Float(), nullable=True),
        sa.Column('crashes_with_weather', sa.Integer(), nullable=True),
        sa.Column('weather_pct', sa.Float(), nullable=True),
        sa.Column('crashes_with_road_cond', sa.Integer(), nullable=True),
        sa.Column('road_cond_pct', sa.Float(), nullable=True),
        sa.Column('crashes_with_lighting', sa.Integer(), nullable=True),
        sa.Column('lighting_pct', sa.Float(), nullable=True),
        sa.Column('crashes_with_alcohol_flag', sa.Integer(), nullable=True),
        sa.Column('alcohol_flag_pct', sa.Float(), nullable=True),
        sa.Column('crashes_alcohol_true', sa.Integer(), nullable=True),
        sa.Column('alcohol_true_pct', sa.Float(), nullable=True),
        sa.Column('crashes_with_distraction_flag', sa.Integer(), nullable=True),
        sa.Column('distraction_flag_pct', sa.Float(), nullable=True),
        sa.Column('crashes_distraction_true', sa.Integer(), nullable=True),
        sa.Column('distraction_true_pct', sa.Float(), nullable=True),
        # Party-level
        sa.Column('total_parties', sa.Integer(), nullable=True),
        sa.Column('parties_with_age', sa.Integer(), nullable=True),
        sa.Column('age_pct', sa.Float(), nullable=True),
        sa.Column('parties_with_gender', sa.Integer(), nullable=True),
        sa.Column('gender_pct', sa.Float(), nullable=True),
        sa.Column('parties_with_sobriety', sa.Integer(), nullable=True),
        sa.Column('sobriety_pct', sa.Float(), nullable=True),
        # Victim-level
        sa.Column('total_victims', sa.Integer(), nullable=True),
        sa.Column('victims_with_injury_severity', sa.Integer(), nullable=True),
        sa.Column('injury_severity_pct', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('county_code', 'year'),
    )
    op.create_index('ix_data_quality_stats_county', 'data_quality_stats', ['county_code'])
    op.create_index('ix_data_quality_stats_year', 'data_quality_stats', ['year'])


def downgrade() -> None:
    op.drop_table('data_quality_stats')
