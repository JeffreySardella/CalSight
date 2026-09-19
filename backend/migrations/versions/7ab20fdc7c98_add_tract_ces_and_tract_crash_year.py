"""add tract_ces and tract_crash_year

Two small new tables for the tract-level equity map layer. Both are empty
CREATE TABLEs — nothing existing is touched, so this is a plain expand.

1. tract_ces — the CalEnviroScreen 5.0 tract rows the loader already fetches
   and currently throws away after averaging them to county. One row per
   ~9,100 CA tracts, keyed by the 11-digit census GEOID.

2. tract_crash_year — crashes-with-coordinates aggregated per (tract, year)
   by etl.compute_tract_crashes (shapely STRtree point-in-polygon; there is
   no PostGIS on this server). No FK to tract_ces: a tract can carry crashes
   without a CES score (and vice versa), and the API left-joins the two.

Grants: pg_default_acl already gives calsight_team read on objects calsight
creates. The guarded GRANTs cover a different migration role and
calsight_api_ro, which exists in neither prod nor CI (hence the guard) —
same pattern as 50bbb1251cb7.

Revision ID: 7ab20fdc7c98
Revises: 10f264138733
Create Date: 2026-09-18 19:38:32.900905
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7ab20fdc7c98'
down_revision: Union[str, None] = '10f264138733'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_GRANTS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_team') THEN
        GRANT SELECT ON tract_ces, tract_crash_year TO calsight_team;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
        GRANT SELECT ON tract_ces, tract_crash_year TO calsight_api_ro;
    END IF;
END
$$;
"""


def upgrade() -> None:
    op.create_table(
        "tract_ces",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("ces_score", sa.Float(), nullable=True),
        sa.Column("ces_percentile", sa.Float(), nullable=True),
        sa.Column("pollution_burden", sa.Float(), nullable=True),
        sa.Column("pop_characteristics", sa.Float(), nullable=True),
        # CES ships an ACS population per tract; it is the only per-tract
        # denominator we have, and without it the layer can only show raw
        # counts (which mostly track how many people live there).
        sa.Column("population", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("geoid"),
    )
    op.create_index("ix_tract_ces_county", "tract_ces", ["county_code"])

    op.create_table(
        "tract_crash_year",
        sa.Column("geoid", sa.String(length=11), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("crash_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("killed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("injured", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("geoid", "year"),
    )
    # The API filters by year range and sums across it; the PK's leading
    # column is geoid, so a year-first index is what that scan wants.
    op.create_index("ix_tract_crash_year_year", "tract_crash_year", ["year"])

    op.execute(_GRANTS)


def downgrade() -> None:
    op.drop_index("ix_tract_crash_year_year", table_name="tract_crash_year")
    op.drop_table("tract_crash_year")
    op.drop_index("ix_tract_ces_county", table_name="tract_ces")
    op.drop_table("tract_ces")
