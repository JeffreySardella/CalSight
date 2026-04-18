"""add land_area, density, crash flags, unemployment, calenviroscreen

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-15 14:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Counties: add land area for density calculations
    op.add_column('counties', sa.Column('land_area_sq_miles', sa.Float(), nullable=True))

    # Demographics: add population density
    op.add_column('demographics', sa.Column('population_density', sa.Float(), nullable=True))

    # Crashes: add derived flags from party data
    op.add_column('crashes', sa.Column('is_alcohol_involved', sa.Boolean(), nullable=True))
    op.add_column('crashes', sa.Column('is_distraction_involved', sa.Boolean(), nullable=True))

    # Unemployment rates table (BLS LAUS)
    op.create_table(
        'unemployment_rates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('county_code', sa.SmallInteger(), sa.ForeignKey('counties.code'), nullable=False),
        sa.Column('year', sa.SmallInteger(), nullable=False),
        sa.Column('month', sa.SmallInteger(), nullable=False),
        sa.Column('unemployment_rate', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('county_code', 'year', 'month'),
    )
    op.create_index('ix_unemployment_rates_county_year', 'unemployment_rates', ['county_code', 'year'])

    # CalEnviroScreen table
    op.create_table(
        'calenviroscreen',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('county_code', sa.SmallInteger(), sa.ForeignKey('counties.code'), nullable=False, unique=True),
        sa.Column('ces_score', sa.Float(), nullable=True),
        sa.Column('ces_percentile', sa.Float(), nullable=True),
        sa.Column('pollution_burden', sa.Float(), nullable=True),
        sa.Column('pop_characteristics', sa.Float(), nullable=True),
        sa.Column('pm25_score', sa.Float(), nullable=True),
        sa.Column('ozone_score', sa.Float(), nullable=True),
        sa.Column('diesel_pm_score', sa.Float(), nullable=True),
        sa.Column('pesticide_score', sa.Float(), nullable=True),
        sa.Column('traffic_score', sa.Float(), nullable=True),
        sa.Column('poverty_pct', sa.Float(), nullable=True),
        sa.Column('unemployment_pct', sa.Float(), nullable=True),
        sa.Column('education_pct', sa.Float(), nullable=True),
        sa.Column('linguistic_isolation_pct', sa.Float(), nullable=True),
        sa.Column('housing_burden_pct', sa.Float(), nullable=True),
        sa.Column('tract_count', sa.SmallInteger(), nullable=True),
        sa.Column('total_population', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_calenviroscreen_county', 'calenviroscreen', ['county_code'])


def downgrade() -> None:
    op.drop_table('calenviroscreen')
    op.drop_table('unemployment_rates')
    op.drop_column('crashes', 'is_distraction_involved')
    op.drop_column('crashes', 'is_alcohol_involved')
    op.drop_column('demographics', 'population_density')
    op.drop_column('counties', 'land_area_sq_miles')
