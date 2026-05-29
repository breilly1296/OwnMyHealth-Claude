#!/usr/bin/env bash
#
# Spin up a local Postgres with the schema + RLS policies applied and a
# NOBYPASSRLS `omh_app` role, so RLS tests run against a role that actually
# has policies enforced (unlike the dev/staging superuser, which bypasses RLS).
#
# Usage:
#   bash backend/scripts/setup-rls-test-db.sh
#   # then, from backend/:
#   DATABASE_URL=postgresql://omh_app:test@localhost:5433/omh \
#   PHI_ENCRYPTION_KEY=<64-hex> npm run test:rls
#
#   bash backend/scripts/setup-rls-test-db.sh --down   # tear the container down
#
# Requires Docker running.
set -euo pipefail

CONTAINER=omh-rls-pg
PORT=5433
DB=omh
SUPER_URL="postgresql://postgres:postgres@localhost:${PORT}/${DB}"
APP_URL="postgresql://omh_app:test@localhost:${PORT}/${DB}"

# Resolve paths relative to this script so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ "${1:-}" == "--down" ]]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "Removed container $CONTAINER."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

# Reuse the container if it's already up; otherwise (re)create it.
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "Starting postgres:16 container '$CONTAINER' on port ${PORT}..."
  docker run -d --name "$CONTAINER" \
    -p "${PORT}:5432" \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB="$DB" \
    postgres:16 >/dev/null
fi

echo "Waiting for Postgres to accept connections..."
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Applying migrations as the superuser..."
( cd "$BACKEND_DIR" && DATABASE_URL="$SUPER_URL" npx prisma migrate deploy --schema=prisma/schema.prisma )

echo "Provisioning the NOBYPASSRLS omh_app role..."
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 \
  < "${BACKEND_DIR}/prisma/rls-test-role.sql"

cat <<EOF

RLS test DB ready.

Run the RLS suite (from ${BACKEND_DIR}):

  DATABASE_URL=${APP_URL} \\
  PHI_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \\
  npm run test:rls

Tear down when finished:

  bash backend/scripts/setup-rls-test-db.sh --down
EOF
