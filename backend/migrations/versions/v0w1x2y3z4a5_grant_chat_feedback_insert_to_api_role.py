"""create chat_feedback if missing + grant INSERT to the API role

Two fixes for POST /api/feedback:

1. The ChatFeedback model was never migrated — no revision creates the
   table, so any environment built purely from `alembic upgrade head`
   is missing it. CREATE TABLE IF NOT EXISTS covers both fresh
   databases and any environment where it was created by hand.

2. The endpoint INSERTs through the API engine, which in production
   connects as `calsight_api_ro` — a SELECT-only role. Every vote 500s
   with "permission denied" there (dev uses a single full-privilege
   URL, so tests never see it). Grant the one narrow write this role
   legitimately needs; everything else stays read-only. No-op when the
   role doesn't exist (local dev, CI databases).

Revision ID: v0w1x2y3z4a5
Revises: u9v0w1x2y3z4
Create Date: 2026-07-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "v0w1x2y3z4a5"
down_revision: Union[str, None] = "u9v0w1x2y3z4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Mirrors app.models.ChatFeedback. IF NOT EXISTS instead of
    # op.create_table because production may already have a hand-made
    # copy of this table.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_feedback (
            id SERIAL PRIMARY KEY,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            provider VARCHAR(30),
            tools_called TEXT,
            vote VARCHAR(4) NOT NULL,
            filters_used TEXT,
            created_at TIMESTAMP DEFAULT now()
        )
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
                GRANT SELECT, INSERT ON chat_feedback TO calsight_api_ro;
                GRANT USAGE ON SEQUENCE chat_feedback_id_seq TO calsight_api_ro;
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    # Leave the table in place (it may hold real feedback); only revoke
    # the write grant this revision added.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro')
               AND to_regclass('public.chat_feedback') IS NOT NULL THEN
                REVOKE INSERT ON chat_feedback FROM calsight_api_ro;
            END IF;
        END
        $$;
        """
    )
