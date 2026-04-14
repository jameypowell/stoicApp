#!/usr/bin/env bash
# One-time (or occasional) copy: production RDS → local Docker Postgres (stoic_dev).
#
# Prerequisites:
#   - Docker container stoic-dev-pg on port 5432 (postgres:17+ recommended; matches prod pg_dump SETs)
#   - libpq: pg_dump, pg_restore, psql (e.g. brew install libpq)
#
# Production credentials (pick one):
#   1) Export for this shell only (recommended):
#        export PROD_DB_HOST=stoic-fitness-pg....rds.amazonaws.com
#        export PROD_DB_USER=stoicapp
#        export PROD_DB_NAME=postgres
#        export PROD_DB_PORT=5432
#        export PROD_DB_PASSWORD='...'
#   2) Or: source scripts/set_production_env.sh   # then re-export as PROD_* below
#
# Local target defaults (override if needed):
#   LOCAL_DB_HOST=127.0.0.1 LOCAL_DB_PORT=5432 LOCAL_DB_NAME=stoic_dev LOCAL_DB_USER=stoicapp LOCAL_DB_PASSWORD=devpass
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROD_DB_HOST="${PROD_DB_HOST:-${DB_HOST:-}}"
PROD_DB_USER="${PROD_DB_USER:-${DB_USER:-stoicapp}}"
PROD_DB_NAME="${PROD_DB_NAME:-${DB_NAME:-postgres}}"
PROD_DB_PORT="${PROD_DB_PORT:-${DB_PORT:-5432}}"
# Prefer explicit PROD_DB_PASSWORD so a local DB_PASSWORD=devpass cannot be sent to RDS by mistake.
PROD_DB_PASSWORD="${PROD_DB_PASSWORD:-}"
if [[ -z "$PROD_DB_PASSWORD" && -n "${DB_PASSWORD:-}" && "${DB_HOST:-}" == "$PROD_DB_HOST" ]]; then
  PROD_DB_PASSWORD="$DB_PASSWORD"
fi

LOCAL_DB_HOST="${LOCAL_DB_HOST:-127.0.0.1}"
LOCAL_DB_PORT="${LOCAL_DB_PORT:-5432}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-stoic_dev}"
LOCAL_DB_USER="${LOCAL_DB_USER:-stoicapp}"
LOCAL_DB_PASSWORD="${LOCAL_DB_PASSWORD:-devpass}"

if [[ -z "${PROD_DB_HOST:-}" || "$PROD_DB_HOST" == "127.0.0.1" || "$PROD_DB_HOST" == "localhost" ]]; then
  echo "Refusing to run: set PROD_DB_HOST to your RDS endpoint (current DB_HOST looks like local dev)."
  exit 1
fi

if [[ -z "${PROD_DB_PASSWORD:-}" ]]; then
  echo "Missing production password. Export PROD_DB_PASSWORD (or DB_PASSWORD while PROD_DB_HOST is set to RDS)."
  exit 1
fi

for cmd in pg_dump pg_restore psql docker; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd"; exit 1; }
done

DUMP="$(mktemp -t stoic-prod-dump)"
trap 'rm -f "$DUMP"' EXIT

echo "→ pg_dump from $PROD_DB_HOST (SSL) …"
export PGSSLMODE=require
export PGPASSWORD="$PROD_DB_PASSWORD"
pg_dump -h "$PROD_DB_HOST" -p "$PROD_DB_PORT" -U "$PROD_DB_USER" -d "$PROD_DB_NAME" \
  --no-owner --no-acl -Fc -f "$DUMP"

echo "→ Recreating local database $LOCAL_DB_NAME …"
unset PGPASSWORD
docker exec stoic-dev-pg psql -U "$LOCAL_DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${LOCAL_DB_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null || true
docker exec stoic-dev-pg psql -U "$LOCAL_DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS \"${LOCAL_DB_NAME}\" WITH (FORCE);" 2>/dev/null \
  || docker exec stoic-dev-pg psql -U "$LOCAL_DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS \"${LOCAL_DB_NAME}\";"
docker exec stoic-dev-pg psql -U "$LOCAL_DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE \"${LOCAL_DB_NAME}\" OWNER \"${LOCAL_DB_USER}\";"

echo "→ pg_restore into $LOCAL_DB_HOST:$LOCAL_DB_PORT/$LOCAL_DB_NAME …"
export PGSSLMODE=disable
export PGPASSWORD="$LOCAL_DB_PASSWORD"
pg_restore -h "$LOCAL_DB_HOST" -p "$LOCAL_DB_PORT" -U "$LOCAL_DB_USER" -d "$LOCAL_DB_NAME" \
  --no-owner --no-acl -j 4 "$DUMP"

echo "→ Apply app migrations / views (node) …"
node -e "
  require('dotenv').config({ override: true, path: require('path').join('$ROOT', '.env') });
  const { initDatabase } = require('$ROOT/database');
  initDatabase().then(c => c.end()).catch(e => { console.error(e); process.exit(1); });
"

echo "Done. Local .env should keep DB_HOST=127.0.0.1 and Stripe test keys."
