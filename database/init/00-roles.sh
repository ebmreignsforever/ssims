#!/bin/bash
# =============================================================================
# PostgreSQL bootstrap roles (runs once, during the official image init).
# The superuser exists only for cluster bootstrap; the API uses ssims_app and
# migrations use ssims_owner. All role passwords come from container env vars.
# =============================================================================
set -euo pipefail

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_OWNER_PASSWORD:?POSTGRES_OWNER_PASSWORD is required}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}"
: "${POSTGRES_RO_PASSWORD:?POSTGRES_RO_PASSWORD is required}"

echo "[init] Creating SSIMS least-privilege roles"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=owner_pw="$POSTGRES_OWNER_PASSWORD" \
  --set=app_pw="$POSTGRES_APP_PASSWORD" \
  --set=ro_pw="$POSTGRES_RO_PASSWORD" \
  --set=dbname="$POSTGRES_DB" <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_owner') THEN
    CREATE ROLE ssims_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_app') THEN
    CREATE ROLE ssims_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssims_readonly') THEN
    CREATE ROLE ssims_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

ALTER ROLE ssims_owner PASSWORD :'owner_pw';
ALTER ROLE ssims_app PASSWORD :'app_pw';
ALTER ROLE ssims_readonly PASSWORD :'ro_pw';

ALTER DATABASE :"dbname" OWNER TO ssims_owner;
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO ssims_owner, ssims_app, ssims_readonly;
EOSQL

echo "[init] Roles ready; migrations will create and grant schema objects"
