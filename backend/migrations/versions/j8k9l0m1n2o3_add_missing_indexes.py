"""Add missing indexes for crash_parties/crash_victims JOINs and mv_wide facets

Addresses DB audit findings:
- Composite (collision_id, data_source) on crash_parties and crash_victims
  for fast JOINs from the crashes table
- party_type and person_type indexes for people endpoint filters
- crash_parties.age and crash_victims.age for age range queries
- Supporting indexes on mv_crashes_wide for common facet queries

Revision ID: j8k9l0m1n2o3
Revises: i7j8k9l0m1n2
Create Date: 2026-05-10 22:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = "j8k9l0m1n2o3"
down_revision: Union[str, None] = "i7j8k9l0m1n2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_index("ix_crash_parties_collision_ds", "crash_parties", ["collision_id", "data_source"])
    op.create_index("ix_crash_victims_collision_ds", "crash_victims", ["collision_id", "data_source"])
    op.create_index("ix_crash_parties_party_type", "crash_parties", ["party_type"])
    op.create_index("ix_crash_victims_person_type", "crash_victims", ["person_type"])
    op.create_index("ix_crash_parties_age", "crash_parties", ["age"])
    op.create_index("ix_crash_victims_age", "crash_victims", ["age"])
    op.create_index("ix_mv_wide_year", "mv_crashes_wide", ["crash_year"])
    op.create_index("ix_mv_wide_severity", "mv_crashes_wide", ["severity"])
    op.create_index("ix_mv_wide_county_year", "mv_crashes_wide", ["county_code", "crash_year"])
    op.create_index("ix_mv_wide_weather", "mv_crashes_wide", ["canonical_weather"])
    op.create_index("ix_mv_wide_lighting", "mv_crashes_wide", ["canonical_lighting"])
    op.create_index("ix_mv_wide_collision_type", "mv_crashes_wide", ["canonical_collision_type"])

def downgrade() -> None:
    op.drop_index("ix_mv_wide_collision_type")
    op.drop_index("ix_mv_wide_lighting")
    op.drop_index("ix_mv_wide_weather")
    op.drop_index("ix_mv_wide_county_year")
    op.drop_index("ix_mv_wide_severity")
    op.drop_index("ix_mv_wide_year")
    op.drop_index("ix_crash_victims_age")
    op.drop_index("ix_crash_parties_age")
    op.drop_index("ix_crash_victims_person_type")
    op.drop_index("ix_crash_parties_party_type")
    op.drop_index("ix_crash_victims_collision_ds")
    op.drop_index("ix_crash_parties_collision_ds")
