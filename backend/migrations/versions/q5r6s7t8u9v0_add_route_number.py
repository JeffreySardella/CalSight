"""add route_number column + index on crashes table

Stores the canonical highway designation extracted from primary_road
("I-5", "US-101", "SR-99"). NULL for local streets or unparseable text.
Backfilled by etl/extract_route_number.py.

The column is added without a default and left NULL on existing rows —
the ETL script populates them in batches to avoid a multi-million-row
UPDATE inside the migration. CREATE INDEX uses CONCURRENTLY to keep the
deploy from blocking on the table lock.

Revision ID: q5r6s7t8u9v0
Revises: p4q5r6s7t8u9
Create Date: 2026-05-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "q5r6s7t8u9v0"
down_revision: Union[str, None] = "p4q5r6s7t8u9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crashes", sa.Column("route_number", sa.String(length=10), nullable=True))
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction. autocommit_block
    # commits the current transaction, switches the connection to AUTOCOMMIT for
    # the duration of the block, then resumes normal transactional DDL.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_crashes_route_number "
            "ON crashes (route_number) WHERE route_number IS NOT NULL"
        )


def downgrade() -> None:
    op.drop_index("ix_crashes_route_number", table_name="crashes")
    op.drop_column("crashes", "route_number")
