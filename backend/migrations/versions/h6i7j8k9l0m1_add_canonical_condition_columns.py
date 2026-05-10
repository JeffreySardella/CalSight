"""Add canonical columns for weather, lighting, road_condition, collision_type

Revision ID: h6i7j8k9l0m1
Revises: g5h6i7j8k9l0
Create Date: 2026-05-10 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "h6i7j8k9l0m1"
down_revision: Union[str, None] = "g5h6i7j8k9l0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.add_column("crashes", sa.Column("canonical_weather", sa.String(15), nullable=True))
    op.add_column("crashes", sa.Column("canonical_lighting", sa.String(15), nullable=True))
    op.add_column("crashes", sa.Column("canonical_road_condition", sa.String(20), nullable=True))
    op.add_column("crashes", sa.Column("canonical_collision_type", sa.String(20), nullable=True))
    op.create_index("ix_crashes_canonical_weather", "crashes", ["canonical_weather"])
    op.create_index("ix_crashes_canonical_lighting", "crashes", ["canonical_lighting"])
    op.create_index("ix_crashes_canonical_road_condition", "crashes", ["canonical_road_condition"])
    op.create_index("ix_crashes_canonical_collision_type", "crashes", ["canonical_collision_type"])

def downgrade() -> None:
    op.drop_index("ix_crashes_canonical_collision_type")
    op.drop_index("ix_crashes_canonical_road_condition")
    op.drop_index("ix_crashes_canonical_lighting")
    op.drop_index("ix_crashes_canonical_weather")
    op.drop_column("crashes", "canonical_collision_type")
    op.drop_column("crashes", "canonical_road_condition")
    op.drop_column("crashes", "canonical_lighting")
    op.drop_column("crashes", "canonical_weather")
