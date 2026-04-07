"""initial schema

Revision ID: 69d22ae6
Revises:
Create Date: 2026-04-05 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "69d22ae6"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- counties (no FK dependencies — must be first) ---
    op.create_table(
        "counties",
        sa.Column("code", sa.SmallInteger(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("fips", sa.String(length=5), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("population", sa.Integer(), nullable=True),
        sa.Column("geojson", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("code"),
        sa.UniqueConstraint("name"),
    )

    # --- crashes (FK → counties.code) ---
    op.create_table(
        "crashes",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("collision_id", sa.BigInteger(), nullable=False),
        sa.Column("crash_datetime", sa.DateTime(), nullable=False),
        sa.Column("day_of_week", sa.String(length=10), nullable=True),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("city_name", sa.String(length=100), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("collision_type", sa.String(length=50), nullable=True),
        sa.Column("primary_factor", sa.String(length=100), nullable=True),
        sa.Column("motor_vehicle_involved_with", sa.String(length=50), nullable=True),
        sa.Column("number_killed", sa.SmallInteger(), nullable=True),
        sa.Column("number_injured", sa.SmallInteger(), nullable=True),
        sa.Column("weather", sa.String(length=30), nullable=True),
        sa.Column("road_condition", sa.String(length=50), nullable=True),
        sa.Column("lighting", sa.String(length=30), nullable=True),
        sa.Column("is_highway", sa.Boolean(), nullable=True),
        sa.Column("is_freeway", sa.Boolean(), nullable=True),
        sa.Column("primary_road", sa.String(length=100), nullable=True),
        sa.Column("secondary_road", sa.String(length=100), nullable=True),
        sa.Column("hit_run", sa.String(length=1), nullable=True),
        sa.Column("pedestrian_involved", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("collision_id"),
    )
    op.create_index("ix_crashes_county_code", "crashes", ["county_code"])
    op.create_index("ix_crashes_crash_datetime", "crashes", ["crash_datetime"])
    op.create_index("ix_crashes_primary_factor", "crashes", ["primary_factor"])
    op.create_index(
        "ix_crashes_county_datetime", "crashes", ["county_code", "crash_datetime"]
    )

    # --- demographics (FK → counties.code) ---
    op.create_table(
        "demographics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("population", sa.Integer(), nullable=True),
        sa.Column("median_age", sa.Float(), nullable=True),
        sa.Column("median_income", sa.Integer(), nullable=True),
        sa.Column("commute_drive_alone_pct", sa.Float(), nullable=True),
        sa.Column("commute_carpool_pct", sa.Float(), nullable=True),
        sa.Column("commute_transit_pct", sa.Float(), nullable=True),
        sa.Column("commute_walk_pct", sa.Float(), nullable=True),
        sa.Column("commute_bike_pct", sa.Float(), nullable=True),
        sa.Column("commute_wfh_pct", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )
    op.create_index("ix_demographics_year", "demographics", ["year"])

    # --- county_insights (FK → counties.code) ---
    op.create_table(
        "county_insights",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("total_crashes", sa.Integer(), nullable=True),
        sa.Column("total_killed", sa.SmallInteger(), nullable=True),
        sa.Column("total_injured", sa.Integer(), nullable=True),
        sa.Column("crash_rate_per_capita", sa.Float(), nullable=True),
        sa.Column("top_cause", sa.String(length=100), nullable=True),
        sa.Column("top_cause_pct", sa.Float(), nullable=True),
        sa.Column("yoy_change_pct", sa.Float(), nullable=True),
        sa.Column("peak_hour", sa.SmallInteger(), nullable=True),
        sa.Column("dui_pct", sa.Float(), nullable=True),
        sa.Column("narrative", sa.Text(), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year"),
    )

    # --- county_insight_details (FK → counties.code) ---
    op.create_table(
        "county_insight_details",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("county_code", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("count", sa.Integer(), nullable=True),
        sa.Column("pct_of_total", sa.Float(), nullable=True),
        sa.Column("yoy_change_pct", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["county_code"], ["counties.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("county_code", "year", "category", "label"),
    )

    # --- etl_runs (no FK dependencies) ---
    op.create_table(
        "etl_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("rows_loaded", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_etl_runs_source_started_at", "etl_runs", ["source", "started_at"]
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_index("ix_etl_runs_source_started_at", table_name="etl_runs")
    op.drop_table("etl_runs")

    op.drop_table("county_insight_details")
    op.drop_table("county_insights")

    op.drop_index("ix_demographics_year", table_name="demographics")
    op.drop_table("demographics")

    op.drop_index("ix_crashes_county_datetime", table_name="crashes")
    op.drop_index("ix_crashes_primary_factor", table_name="crashes")
    op.drop_index("ix_crashes_crash_datetime", table_name="crashes")
    op.drop_index("ix_crashes_county_code", table_name="crashes")
    op.drop_table("crashes")

    op.drop_table("counties")
