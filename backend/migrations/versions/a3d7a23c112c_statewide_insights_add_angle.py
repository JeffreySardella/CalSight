"""statewide_insights_add_angle

Revision ID: a3d7a23c112c
Revises: b939e12fc289
Create Date: 2026-05-07 22:49:34.841137
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3d7a23c112c'
down_revision: Union[str, None] = 'b939e12fc289'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('statewide_insights', sa.Column('angle', sa.String(length=40), nullable=True))
    op.execute("UPDATE statewide_insights SET angle = 'overview' WHERE angle IS NULL")
    op.alter_column('statewide_insights', 'angle', nullable=False)
    op.drop_constraint('statewide_insights_year_key', 'statewide_insights', type_='unique')
    op.create_index('ix_statewide_insights_year', 'statewide_insights', ['year'], unique=False)
    op.create_unique_constraint('uq_statewide_year_angle', 'statewide_insights', ['year', 'angle'])


def downgrade() -> None:
    op.drop_constraint('uq_statewide_year_angle', 'statewide_insights', type_='unique')
    op.drop_index('ix_statewide_insights_year', table_name='statewide_insights')
    op.create_unique_constraint('statewide_insights_year_key', 'statewide_insights', ['year'])
    op.drop_column('statewide_insights', 'angle')
