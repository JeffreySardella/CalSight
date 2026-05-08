"""statewide_insights_table

Revision ID: b939e12fc289
Revises: 985d0c62c1ac
Create Date: 2026-05-07 22:31:50.442536
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b939e12fc289'
down_revision: Union[str, None] = '985d0c62c1ac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('statewide_insights',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('total_crashes', sa.Integer(), nullable=True),
    sa.Column('total_killed', sa.Integer(), nullable=True),
    sa.Column('total_injured', sa.Integer(), nullable=True),
    sa.Column('narrative', sa.Text(), nullable=True),
    sa.Column('data_source', sa.String(length=10), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('year')
    )


def downgrade() -> None:
    op.drop_table('statewide_insights')
