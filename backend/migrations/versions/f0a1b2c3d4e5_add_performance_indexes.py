"""add performance indexes for map, severity, and range queries

Adds three targeted indexes for the highest-traffic dashboard queries:

  1. ix_crashes_coords_partial — partial index on (county_code, crash_datetime)
     where latitude is not null. Only 37% of crashes have coordinates, so
     this index is ~4M rows instead of 11M. Every "map" query hits it.

  2. ix_crashes_county_severity_datetime — composite for the common filter
     pattern "crashes in county X of severity Y over time range Z".
     Without this, severity filtering does a seq scan even when combined
     with a county filter.

  3. ix_crashes_datetime_brin — BRIN index on crash_datetime. BRIN is
     ~1000x smaller than B-tree and is effective for columns with natural
     physical ordering (insertion order = chronological for crash data).
     Complements the existing B-tree — Postgres picks whichever is better
     per query.

Indexes NOT added (because they already exist):
  - ix_crashes_severity — created in e5f6a7b8c9d0
  - (collision_id, data_source) — uq_crashes_collision_source unique constraint
    already provides the covering index

After running this migration, VACUUM ANALYZE crashes is recommended so the
planner has fresh statistics. The run_all_etl.sh script ends with a
vacuum_analyze step for this reason.

Revision ID: f0a1b2c3d4e5
Revises: e5f6a7b8c9d0
Create Date: 2026-04-16 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Partial index — only includes rows where latitude IS NOT NULL.
    # Dramatically smaller than a full index on 11M rows since 63% lack coords.
    op.execute("""
        CREATE INDEX ix_crashes_coords_partial
        ON crashes (county_code, crash_datetime)
        WHERE latitude IS NOT NULL
    """)

    # Composite for the "county + severity + time range" filter combo.
    # Leftmost-prefix means queries on (county_code, severity) alone also benefit.
    op.create_index(
        "ix_crashes_county_severity_datetime",
        "crashes",
        ["county_code", "severity", "crash_datetime"],
    )

    # BRIN index — tiny, covers bulk range scans well.
    # Only useful because crashes are inserted in chronological order so
    # physical storage order roughly matches crash_datetime order.
    op.execute("""
        CREATE INDEX ix_crashes_datetime_brin
        ON crashes USING BRIN (crash_datetime)
    """)


def downgrade() -> None:
    op.drop_index("ix_crashes_datetime_brin")
    op.drop_index("ix_crashes_county_severity_datetime")
    op.drop_index("ix_crashes_coords_partial")
