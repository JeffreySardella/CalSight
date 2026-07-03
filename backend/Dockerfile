# Pin to Debian 13 (trixie) explicitly. The floating `python:3.12-slim` tag
# already moved bookworm -> trixie, which is what broke the previous PGDG
# pin (its bookworm libpq5 wants libldap-2.5, absent on trixie). Pinning the
# codename keeps the base from shifting under us again.
FROM python:3.12-slim-trixie

WORKDIR /app

# pg_dump must match the server's major version (17) so it can dump it —
# an older client refuses a newer server. Debian 13 (trixie) ships
# postgresql-client-17 in its own repos, so no PGDG repo is needed. apt runs
# in its own layer, before the requirements COPY, so a dependency bump
# doesn't re-run it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 8000

CMD ["gunicorn", "app.main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000"]
