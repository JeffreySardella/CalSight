"""etl_orchestrator_fields

Revision ID: 985d0c62c1ac
Revises: h5i6j7k8l9m0
Create Date: 2026-05-07 16:39:08.067216
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '985d0c62c1ac'
down_revision: Union[str, None] = 'h5i6j7k8l9m0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('etl_runs', sa.Column('validation_status', sa.String(length=20), nullable=True))
    op.add_column('etl_runs', sa.Column('rows_before', sa.Integer(), nullable=True))
    op.add_column('etl_runs', sa.Column('rows_after', sa.Integer(), nullable=True))
    op.add_column('etl_runs', sa.Column('diff_summary', sa.Text(), nullable=True))
    op.add_column('etl_runs', sa.Column('triggered_by', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('etl_runs', 'triggered_by')
    op.drop_column('etl_runs', 'diff_summary')
    op.drop_column('etl_runs', 'rows_after')
    op.drop_column('etl_runs', 'rows_before')
    op.drop_column('etl_runs', 'validation_status')
