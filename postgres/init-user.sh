#!/bin/bash
# =============================================================================
# FW Migrate: Create least-privilege application role
# =============================================================================
# This script runs on first container init (docker-entrypoint-initdb.d).
# It creates a dedicated 'fwmigrate' user with DML-only privileges.
# The postgres superuser remains for migrations and admin tasks only.
# =============================================================================

set -e

# Require a dedicated app password — fail loudly rather than reuse the superuser password
APP_PASSWORD="${FWMIGRATE_DB_PASSWORD:?FWMIGRATE_DB_PASSWORD required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create app-specific role with minimal privileges
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'fwmigrate') THEN
            CREATE USER fwmigrate WITH PASSWORD '${APP_PASSWORD}';
        END IF;
    END
    \$\$;

    -- Grant connection and schema access
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO fwmigrate;
    GRANT USAGE ON SCHEMA public TO fwmigrate;

    -- Grant DML-only access (no CREATE, DROP, ALTER, TRUNCATE)
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fwmigrate;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fwmigrate;

    -- Auto-grant on future tables/sequences created by migrations
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fwmigrate;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO fwmigrate;
EOSQL

echo ">>> FW Migrate app user 'fwmigrate' created with least-privilege grants"
