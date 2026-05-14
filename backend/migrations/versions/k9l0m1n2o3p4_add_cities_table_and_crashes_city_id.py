"""add cities table and crashes.city_id

Revision ID: k9l0m1n2o3p4
Revises: j8k9l0m1n2o3
Create Date: 2026-05-13 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "k9l0m1n2o3p4"
down_revision: Union[str, None] = "j8k9l0m1n2o3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("name_normalized", sa.String(length=100), nullable=False),
        sa.Column("place_type", sa.String(length=20), nullable=False),
        sa.Column("place_fips", sa.String(length=7), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "name", name="uq_cities_county_name"),
    )
    op.create_index("ix_cities_county_normalized", "cities", ["county_code", "name_normalized"])
    op.create_index("ix_cities_name_normalized", "cities", ["name_normalized"])

    op.add_column("crashes", sa.Column("city_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_crashes_city_id_cities",
        "crashes",
        "cities",
        ["city_id"],
        ["id"],
    )
    op.create_index(
        "ix_crashes_city_id",
        "crashes",
        ["city_id"],
        postgresql_where=sa.text("city_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_crashes_city_id", table_name="crashes")
    op.drop_constraint("fk_crashes_city_id_cities", "crashes", type_="foreignkey")
    op.drop_column("crashes", "city_id")

    op.drop_index("ix_cities_name_normalized", table_name="cities")
    op.drop_index("ix_cities_county_normalized", table_name="cities")
    op.drop_table("cities")
