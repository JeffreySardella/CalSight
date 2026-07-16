"""add lat/lon columns to reservoirs (water v2 map integration)

Nullable ADD COLUMNs on a 15-row table — instant, no rewrite, no
CONCURRENTLY needed. Values come from the static MAJOR_RESERVOIRS map
(station coordinates verified against each station's CDEC staMeta page)
and are written by etl/load_reservoirs.py on its next run; no data
backfill happens here. The existing table-level SELECT grant to
calsight_api_ro covers new columns automatically, so no re-grant.

Revision ID: e09358c7c0d1
Revises: b6c7d8e9f0a1
Create Date: 2026-07-15 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# Revision id deliberately random (not an increment of the previous one) —
# sequential-looking ids from parallel sessions have collided before.
revision: str = "e09358c7c0d1"
down_revision: Union[str, None] = "b6c7d8e9f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("reservoirs", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("reservoirs", sa.Column("lon", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("reservoirs", "lon")
    op.drop_column("reservoirs", "lat")
