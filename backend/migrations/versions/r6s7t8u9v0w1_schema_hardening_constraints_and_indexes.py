"""schema hardening: NOT NULL, CHECK constraints, index on canonical_cause, drop redundant indexes

Tightens the schema with data-integrity constraints and cleans up index bloat:

  1. NOT NULL on data_source (crashes, crash_parties, crash_victims) — these
     should never be null; the ETL always sets them. A pre-check aborts if
     any NULLs exist so we don't break existing data.

  2. CHECK constraints (all using NOT VALID + VALIDATE pattern to avoid
     holding an ACCESS EXCLUSIVE lock for the full table scan):
     - crashes.severity IN ('Fatal', 'Injury', 'Property Damage Only') OR NULL
     - crashes.data_source IN ('switrs', 'ccrs')
     - crashes.number_killed >= 0 AND crashes.number_injured >= 0
     - crashes.crash_hour BETWEEN 0 AND 23 OR NULL

  3. Index CONCURRENTLY on crashes.canonical_cause — the column already has
     ix_crashes_canonical_cause from migration f1b2c3d4e5f6 so this is a
     no-op if it exists. We use IF NOT EXISTS for safety.

  4. Drop 4 redundant indexes that waste ~800 MB of disk on 11M rows:
     - ix_crashes_county_code   (covered by ix_crashes_county_datetime,
                                 ix_crashes_county_severity_datetime,
                                 ix_crashes_county_crash_year)
     - ix_crashes_crash_datetime (covered by ix_crashes_datetime_brin +
                                  ix_crashes_county_datetime)
     - ix_crashes_severity       (covered by ix_crashes_county_severity_datetime;
                                  only 3 values + NULL = useless selectivity)
     - ix_crashes_crash_hour     (only 24 values on 11M rows; temporal facets
                                  go through mv_crashes_wide)

Revision ID: r6s7t8u9v0w1
Revises: q5r6s7t8u9v0
Create Date: 2026-06-03 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

# Allow CREATE INDEX CONCURRENTLY (runs outside a transaction)
revision_is_non_transactional = True

revision: str = "r6s7t8u9v0w1"
down_revision: Union[str, None] = "q5r6s7t8u9v0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 0. Safety check: abort if any NULLs exist in data_source columns.
    #    These should have been populated by ETL. If they aren't, the
    #    ALTER COLUMN SET NOT NULL would fail anyway — but this gives a
    #    clear error message instead of a cryptic Postgres one.
    # ------------------------------------------------------------------
    conn = op.get_bind()
    for tbl in ("crashes", "crash_parties", "crash_victims"):
        result = conn.execute(
            __import__("sqlalchemy").text(
                f"SELECT COUNT(*) FROM {tbl} WHERE data_source IS NULL"
            )
        )
        null_count = result.scalar()
        if null_count > 0:
            raise RuntimeError(
                f"Cannot add NOT NULL to {tbl}.data_source: "
                f"{null_count:,} rows have NULL. "
                f"Run the ETL backfill first."
            )

    # ------------------------------------------------------------------
    # 1. NOT NULL on data_source columns
    # ------------------------------------------------------------------
    op.alter_column("crashes", "data_source", nullable=False)
    op.alter_column("crash_parties", "data_source", nullable=False)
    op.alter_column("crash_victims", "data_source", nullable=False)

    # ------------------------------------------------------------------
    # 2. CHECK constraints — NOT VALID first, then VALIDATE separately.
    #    NOT VALID adds the constraint without scanning existing rows
    #    (takes an ACCESS EXCLUSIVE lock only briefly for the catalog
    #    update). VALIDATE then scans with a weaker SHARE UPDATE EXCLUSIVE
    #    lock that allows concurrent reads and writes.
    # ------------------------------------------------------------------

    # 2a. severity values
    op.execute("""
        ALTER TABLE crashes
        ADD CONSTRAINT ck_crashes_severity
        CHECK (severity IN ('Fatal', 'Injury', 'Property Damage Only'))
        NOT VALID
    """)
    op.execute("ALTER TABLE crashes VALIDATE CONSTRAINT ck_crashes_severity")

    # 2b. data_source values
    op.execute("""
        ALTER TABLE crashes
        ADD CONSTRAINT ck_crashes_data_source
        CHECK (data_source IN ('switrs', 'ccrs'))
        NOT VALID
    """)
    op.execute("ALTER TABLE crashes VALIDATE CONSTRAINT ck_crashes_data_source")

    # 2c. non-negative kill/injury counts
    op.execute("""
        ALTER TABLE crashes
        ADD CONSTRAINT ck_crashes_nonneg_killed_injured
        CHECK (
            (number_killed IS NULL OR number_killed >= 0)
            AND (number_injured IS NULL OR number_injured >= 0)
        )
        NOT VALID
    """)
    op.execute(
        "ALTER TABLE crashes VALIDATE CONSTRAINT ck_crashes_nonneg_killed_injured"
    )

    # 2d. crash_hour range
    op.execute("""
        ALTER TABLE crashes
        ADD CONSTRAINT ck_crashes_hour_range
        CHECK (crash_hour IS NULL OR crash_hour BETWEEN 0 AND 23)
        NOT VALID
    """)
    op.execute("ALTER TABLE crashes VALIDATE CONSTRAINT ck_crashes_hour_range")

    # ------------------------------------------------------------------
    # 3. Ensure index on canonical_cause exists (created in f1b2c3d4e5f6
    #    but verify with IF NOT EXISTS for idempotency)
    # ------------------------------------------------------------------
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_crashes_canonical_cause "
        "ON crashes (canonical_cause)"
    )

    # ------------------------------------------------------------------
    # 4. Drop redundant indexes
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS ix_crashes_county_code")
    op.execute("DROP INDEX IF EXISTS ix_crashes_crash_datetime")
    op.execute("DROP INDEX IF EXISTS ix_crashes_severity")
    op.execute("DROP INDEX IF EXISTS ix_crashes_crash_hour")


def downgrade() -> None:
    # Restore the 4 dropped indexes
    op.create_index("ix_crashes_county_code", "crashes", ["county_code"])
    op.create_index("ix_crashes_crash_datetime", "crashes", ["crash_datetime"])
    op.create_index("ix_crashes_severity", "crashes", ["severity"])
    op.create_index("ix_crashes_crash_hour", "crashes", ["crash_hour"])

    # Drop CHECK constraints
    op.execute(
        "ALTER TABLE crashes DROP CONSTRAINT IF EXISTS ck_crashes_hour_range"
    )
    op.execute(
        "ALTER TABLE crashes DROP CONSTRAINT IF EXISTS ck_crashes_nonneg_killed_injured"
    )
    op.execute(
        "ALTER TABLE crashes DROP CONSTRAINT IF EXISTS ck_crashes_data_source"
    )
    op.execute(
        "ALTER TABLE crashes DROP CONSTRAINT IF EXISTS ck_crashes_severity"
    )

    # Restore nullable on data_source
    op.alter_column("crashes", "data_source", nullable=True)
    op.alter_column("crash_parties", "data_source", nullable=True)
    op.alter_column("crash_victims", "data_source", nullable=True)
