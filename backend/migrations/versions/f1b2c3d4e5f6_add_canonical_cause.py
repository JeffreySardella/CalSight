"""add canonical_cause column to crashes for fast dashboard filtering

The raw primary_factor field has 12,517 distinct values — a mix of plain-English
labels from SWITRS ("speeding", "dui", "unsafe lane change") and California
Vehicle Code section numbers from CCRS ("22350", "VC 23152(a)", "21658A").
The top 50 values cover ~94% of rows.

The frontend dashboard needs to filter by a small, stable set of categories.
This column pre-computes that categorization so API endpoints can do
`WHERE canonical_cause = 'speeding'` instead of a big CASE WHEN on every query.

Values populated by the backfill (see etl/backfill_derived.py):
  - 'speeding'    — VC 22350 variants + English "speeding" / "unsafe speed"
  - 'dui'         — VC 23152 variants + English "dui"
  - 'lane_change' — VC 21658 / 21650 variants + "lane change" / "improper passing"
  - 'other'       — everything else (turning, right-of-way, signals, backing, etc.)
  - NULL          — row has no primary_factor (preserve "no data" vs "other cause")

Categories 'distracted' and 'weather' are derivable from existing columns:
  - distracted → is_distraction_involved = TRUE
  - weather    → weather IN ('Raining', 'Snowing', 'Fog', 'Sleet/Hail')
The API layer combines canonical_cause with those columns to expose the
frontend's 6-category filter.

Revision ID: f1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-04-17 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1b2c3d4e5f6'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "crashes",
        sa.Column("canonical_cause", sa.String(20), nullable=True),
    )
    # Index for API filter queries. Small cardinality (4 values + NULL) but
    # queries like "fatal crashes where canonical_cause = 'dui'" are very
    # common in the dashboard, and this combined with county_code covers them.
    op.create_index(
        "ix_crashes_canonical_cause",
        "crashes",
        ["canonical_cause"],
    )


def downgrade() -> None:
    op.drop_index("ix_crashes_canonical_cause")
    op.drop_column("crashes", "canonical_cause")
