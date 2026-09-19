"""add vmt table

County vehicle miles traveled per year, from CARB EMFAC. New empty table —
plain CREATE TABLE, nothing else reads it yet. `source` records the EMFAC
model version that produced each row, since a future release restates them.

`calsight_team` read comes from pg_default_acl on objects calsight creates.
The guarded GRANT covers `calsight_api_ro`, which exists in neither prod nor
CI today (hence the guard) but is the convention every table migration since
fa863b601b57 follows.

Revision ID: 5d8342ec4f96
Revises: 50bbb1251cb7
Create Date: 2026-09-18 20:08:03.730714
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5d8342ec4f96'
down_revision: Union[str, None] = '50bbb1251cb7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "vmt",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("vmt_millions", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )
    op.create_index("ix_vmt_county_year", "vmt", ["county_code", "year"])
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT ON vmt TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_vmt_county_year", table_name="vmt")
    op.drop_table("vmt")
