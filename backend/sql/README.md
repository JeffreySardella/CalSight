# `backend/sql/`

Hand-run SQL scripts. These are NOT alembic migrations — alembic owns the
schema. Files here cover infra/ops tasks that don't belong in a model
migration:

- **`create_readonly_role.sql`** — provisions the `calsight_api_ro` role
  used by the FastAPI container. Defense-in-depth so a compromised
  dependency can't run destructive SQL. Run once per environment after
  bootstrapping the database, and re-run after rotating the role's
  password. See the file header for the exact `psql` invocation.

After running `create_readonly_role.sql` against Azure, the production
`.env` should look like:

```
# Read-only role — used by the FastAPI container
DATABASE_URL_AZURE=postgresql://calsight_api_ro:...@<host>/calsight

# Superuser — used by alembic + ETL only
ETL_DATABASE_URL_AZURE=postgresql://calsight:...@<host>/calsight
```

Locally, you can leave the ETL URL blank — see `CLAUDE.md` for the
fallback rules.
