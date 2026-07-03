-- Create the read-only Postgres role used by the FastAPI backend.
--
-- WHY:
--   The API is SELECT-only except for one narrow write (chat_feedback
--   votes, granted below). Not having broader write access means a
--   compromised dependency can't DROP, DELETE, or UPDATE anything.
--   Defense-in-depth.
--
-- WHO RUNS THIS:
--   The Azure Postgres admin (i.e. you). ETL + alembic stay on the
--   superuser role; only the API container connects as `calsight_api_ro`.
--
-- HOW TO RUN:
--   psql "<superuser connection string>" -v ON_ERROR_STOP=1 \
--        -v role_password="'replace-me-with-a-real-password'" \
--        -f backend/sql/create_readonly_role.sql
--
--   Then update the production .env so DATABASE_URL_AZURE points at
--   `calsight_api_ro` and ETL_DATABASE_URL_AZURE points at the superuser
--   role. See CLAUDE.md for the env-var layout.
--
-- IDEMPOTENT:
--   Re-running is safe. CREATE ROLE / CREATE SCHEMA bits are guarded;
--   GRANTs are no-ops if already granted.

\set ON_ERROR_STOP on

BEGIN;

-- 1. The role itself. Login-enabled, no inherited superpowers.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calsight_api_ro') THEN
        EXECUTE format(
            'CREATE ROLE calsight_api_ro LOGIN PASSWORD %L',
            current_setting('role_password')
        );
    ELSE
        EXECUTE format(
            'ALTER ROLE calsight_api_ro WITH LOGIN PASSWORD %L',
            current_setting('role_password')
        );
    END IF;
END
$$;

-- 2. Connect + schema-usage perms.
GRANT CONNECT ON DATABASE calsight TO calsight_api_ro;
GRANT USAGE   ON SCHEMA   public   TO calsight_api_ro;

-- 3. SELECT on everything that currently exists. Sequences are also
--    granted USAGE/SELECT — SQLAlchemy autoflush sometimes peeks at
--    nextval()-style queries even on pure-read sessions.
GRANT SELECT                  ON ALL TABLES    IN SCHEMA public TO calsight_api_ro;
GRANT SELECT, USAGE           ON ALL SEQUENCES IN SCHEMA public TO calsight_api_ro;

-- 3b. The one narrow write the API performs: POST /api/feedback stores
--     thumbs up/down votes in chat_feedback. Everything else stays
--     SELECT-only. (Also applied by migration v0w1x2y3z4a5.)
GRANT INSERT ON chat_feedback              TO calsight_api_ro;
GRANT USAGE  ON SEQUENCE chat_feedback_id_seq TO calsight_api_ro;

-- 4. Future-proof: when alembic adds a new table or the ETL creates a
--    new materialized view tomorrow, the API role automatically gets
--    SELECT on it. Without this, every migration would need a manual
--    GRANT step on the Azure side.
--
--    The `FOR ROLE` argument has to be the role that *creates* the
--    object. Adjust to match whichever superuser runs alembic / ETL
--    (typically `calsight`).
ALTER DEFAULT PRIVILEGES FOR ROLE calsight IN SCHEMA public
    GRANT SELECT ON TABLES TO calsight_api_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE calsight IN SCHEMA public
    GRANT SELECT, USAGE ON SEQUENCES TO calsight_api_ro;

COMMIT;

-- 5. Sanity check — print what we just granted. Look for ~30 tables /
--    materialized views in the output; if you see <10 the GRANT
--    didn't take.
\echo
\echo 'Tables visible to calsight_api_ro:'
SELECT table_schema, table_name
FROM information_schema.table_privileges
WHERE grantee = 'calsight_api_ro'
  AND privilege_type = 'SELECT'
ORDER BY table_schema, table_name;
