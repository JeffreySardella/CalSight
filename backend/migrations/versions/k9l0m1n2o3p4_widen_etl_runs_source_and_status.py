"""widen etl_runs.source and status columns from varchar(20) to varchar(50)

Fixes StringDataRightTruncation crash when source name exceeds 20 chars
(e.g. "vehicle_registrations" is 22 chars).

Revision ID: k9l0m1n2o3p4
Revises: j8k9l0m1n2o3
Create Date: 2026-05-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k9l0m1n2o3p4'
down_revision: Union[str, None] = 'j8k9l0m1n2o3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('etl_runs', 'source', type_=sa.String(50), existing_nullable=False)
    op.alter_column('etl_runs', 'status', type_=sa.String(50), existing_nullable=False)
    op.alter_column('etl_runs', 'validation_status', type_=sa.String(50), existing_nullable=True)
    op.alter_column('etl_runs', 'triggered_by', type_=sa.String(50), existing_nullable=True)


def downgrade() -> None:
    op.alter_column('etl_runs', 'source', type_=sa.String(20), existing_nullable=False)
    op.alter_column('etl_runs', 'status', type_=sa.String(20), existing_nullable=False)
    op.alter_column('etl_runs', 'validation_status', type_=sa.String(20), existing_nullable=True)
    op.alter_column('etl_runs', 'triggered_by', type_=sa.String(20), existing_nullable=True)
