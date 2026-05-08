"""add county_insight_cards table

Revision ID: c4e8f1a2b3d5
Revises: a3d7a23c112c
Create Date: 2026-05-07 23:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e8f1a2b3d5'
down_revision: Union[str, None] = 'a3d7a23c112c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'county_insight_cards',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('county_code', sa.Integer(), sa.ForeignKey('counties.code'), nullable=False),
        sa.Column('county_name', sa.String(length=50), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('angle', sa.String(length=40), nullable=False),
        sa.Column('narrative', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('county_code', 'year', 'angle'),
    )
    op.create_index(
        'ix_county_insight_cards_county_year',
        'county_insight_cards',
        ['county_code', 'year'],
    )


def downgrade() -> None:
    op.drop_index('ix_county_insight_cards_county_year', table_name='county_insight_cards')
    op.drop_table('county_insight_cards')
