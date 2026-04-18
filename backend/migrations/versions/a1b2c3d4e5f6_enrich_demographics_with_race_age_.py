"""enrich demographics with race, age, poverty, education, housing, language

Revision ID: a1b2c3d4e5f6
Revises: fd0e0a46c42d
Create Date: 2026-04-15 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'fd0e0a46c42d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Race/Ethnicity
    op.add_column('demographics', sa.Column('pct_white', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_black', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_asian', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_hispanic', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_other_race', sa.Float(), nullable=True))

    # Age distribution
    op.add_column('demographics', sa.Column('pct_under_18', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_18_24', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_25_44', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_45_64', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_65_plus', sa.Float(), nullable=True))

    # Socioeconomic
    op.add_column('demographics', sa.Column('poverty_rate', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_bachelors_or_higher', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_high_school_or_higher', sa.Float(), nullable=True))

    # Transportation / Housing
    op.add_column('demographics', sa.Column('pct_no_vehicle', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_owner_occupied_housing', sa.Float(), nullable=True))

    # Language
    op.add_column('demographics', sa.Column('pct_english_only', sa.Float(), nullable=True))
    op.add_column('demographics', sa.Column('pct_spanish_speaking', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('demographics', 'pct_spanish_speaking')
    op.drop_column('demographics', 'pct_english_only')
    op.drop_column('demographics', 'pct_owner_occupied_housing')
    op.drop_column('demographics', 'pct_no_vehicle')
    op.drop_column('demographics', 'pct_high_school_or_higher')
    op.drop_column('demographics', 'pct_bachelors_or_higher')
    op.drop_column('demographics', 'pct_65_plus')
    op.drop_column('demographics', 'pct_45_64')
    op.drop_column('demographics', 'pct_25_44')
    op.drop_column('demographics', 'pct_18_24')
    op.drop_column('demographics', 'pct_under_18')
    op.drop_column('demographics', 'poverty_rate')
    op.drop_column('demographics', 'pct_other_race')
    op.drop_column('demographics', 'pct_hispanic')
    op.drop_column('demographics', 'pct_asian')
    op.drop_column('demographics', 'pct_black')
    op.drop_column('demographics', 'pct_white')
