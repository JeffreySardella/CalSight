"""drop unused ix_crashes_canonical_road_condition

DB audit (2026-07-09, issue #292): pg_stat_user_indexes shows zero scans for
this index. No API query filters or groups by canonical_road_condition — the
column is written by etl/backfill_conditions.py and read only through
mv_crashes_wide / full scans, neither of which uses a single-column b-tree.
On an 11M-row table the index costs write amplification on every daily load
for no read benefit, so drop it.

The column itself stays; only the index goes. Recreate on downgrade.

Revision ID: w1x2y3z4a5b6
Revises: v0w1x2y3z4a5
Create Date: 2026-07-10 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "w1x2y3z4a5b6"
down_revision: Union[str, None] = "v0w1x2y3z4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_crashes_canonical_road_condition")


def downgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_crashes_canonical_road_condition "
        "ON crashes (canonical_road_condition)"
    )
