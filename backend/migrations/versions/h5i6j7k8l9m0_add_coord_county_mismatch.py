"""add coord_county_mismatch + coord_validated_at to crashes

Boolean column set by etl.validate_coords when a crash's lat/lng falls
outside the polygon of its assigned county_code. NULL = not yet checked.
Timestamp records when validation last ran so auditors can check freshness.

Issue: #154

Revision ID: h5i6j7k8l9m0
Revises: g4h5i6j7k8l9
Create Date: 2026-05-06 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h5i6j7k8l9m0'
down_revision: Union[str, None] = 'g4h5i6j7k8l9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crashes", sa.Column("coord_county_mismatch", sa.Boolean))
    op.add_column("crashes", sa.Column("coord_validated_at", sa.DateTime))
    op.create_index(
        "ix_crashes_coord_mismatch",
        "crashes",
        ["coord_county_mismatch"],
        postgresql_where=sa.text("coord_county_mismatch = TRUE"),
    )


def downgrade() -> None:
    op.drop_index("ix_crashes_coord_mismatch", table_name="crashes")
    op.drop_column("crashes", "coord_validated_at")
    op.drop_column("crashes", "coord_county_mismatch")
