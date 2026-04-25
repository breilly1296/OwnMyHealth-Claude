#!/usr/bin/env bash
#
# check-rls-wrappers.sh — fail CI if any controller/service bypasses RLS.
#
# Inside a withRLSContext / withRLSTransaction callback, all queries must go
# through the `tx` parameter. A bare `prisma.<model>.<method>(` call uses the
# module-level client, which runs on a different connection and silently
# ignores SET LOCAL app.current_user_id — bypassing RLS.
#
# The grep below flags bare `prisma.<model>.<verb>(` calls in controllers
# and services. Lines containing `tx.` or `// RLS-exempt` (intentional
# migration/infra paths) are excluded. Test files are excluded because
# mocks frequently reference the bare client.
#
# To allow a specific call, append `// RLS-exempt: <reason>` on the same line.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# C-8 PR B — TARGETS covers every directory where app code can plausibly
# acquire a Prisma client. controllers/services/routes/schedulers/middleware
# were the original surface; utils/ is added so a future "shared query
# helper" can't slip past the guard. config/ and types/ are intentionally
# out: env-loading and type-only files don't acquire a Prisma client, and
# generated/ is generated code (Prisma's own internals).
TARGETS=(
  "$ROOT_DIR/backend/src/controllers"
  "$ROOT_DIR/backend/src/services"
  "$ROOT_DIR/backend/src/routes"
  "$ROOT_DIR/backend/src/schedulers"
  "$ROOT_DIR/backend/src/middleware"
  "$ROOT_DIR/backend/src/utils"
)

# database.ts legitimately contains `prisma.<model>.<verb>(` in its docblock
# as an ANTI-example. Exclude it — the rest of the file only uses the
# module-level client inside `runWithRLS` itself, which is the definition
# of the wrapper, not a caller of it.
EXCLUDE_FILES=(
  "$ROOT_DIR/backend/src/services/database.ts"
)

# Flag bare module-level prisma calls in two shapes:
#   1. ORM model calls — `prisma.<model>.<verb>(` (findMany, create, etc).
#      The prior enum-based list went stale every time a model was added or
#      renamed (dnaData removal in 2026-04-23 left stale entries here).
#      Matching the shape directly is more robust.
#   2. Raw-SQL and transaction entry points — `prisma.$queryRaw(`,
#      `prisma.$executeRaw(`, `prisma.$transaction(`, and the Unsafe
#      siblings. These bypass the wrapper the same way a model call does:
#      a raw query against a table with RLS policies runs with no
#      `app.current_user_id` set. C-8 PR B widens the guard so a future
#      raw-SQL helper doesn't slip past the CI check.
#
# Legitimate uses of `prisma.$queryRaw` / `$transaction` in database.ts
# (the pg_roles assertion, the `SELECT 1` health ping, and the wrapper
# implementation itself) live in a file that's already in EXCLUDE_FILES
# below — no per-line annotation needed there.
PATTERN='\bprisma\.([a-zA-Z_][a-zA-Z0-9_]*\.(findMany|findFirst|findUnique|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)|\$queryRaw|\$queryRawUnsafe|\$executeRaw|\$executeRawUnsafe|\$transaction)\('

RAW_HITS=$(grep -rnE "$PATTERN" "${TARGETS[@]}" \
  --include='*.ts' \
  --exclude='*.test.ts' \
  --exclude='*.spec.ts' \
  --exclude-dir='__tests__' \
  2>/dev/null \
  | grep -v 'tx\.' \
  | grep -v '// RLS-exempt' \
  || true)

# Filter out lines from explicitly excluded files.
HITS="$RAW_HITS"
for excl in "${EXCLUDE_FILES[@]}"; do
  HITS=$(echo "$HITS" | grep -vF "$excl" || true)
done

if [ -n "$HITS" ]; then
  echo "::error::RLS bypass detected — use tx.* inside withRLSContext callbacks (see backend/src/services/database.ts header)."
  echo "$HITS"
  exit 1
fi

echo "RLS wrapper check passed."
